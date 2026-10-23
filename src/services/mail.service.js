import nodemailer from 'nodemailer';
import QRCode from 'qrcode';
import {
  buildIngresoEquipoEmail,
  buildInvitacionEmpleadoEmail,
  buildPasswordChangedEmail,
  buildResetEmail,
  buildVerificacionCorreoEmail,
  buildWelcomeEmail,
  buildMontoFaltanteEmail,
} from '../utils/emailTemplates.js';

let transporte = null;

function hayCredenciales() {
  return Boolean(process.env.MAIL_USER && (process.env.MAIL_PASS || process.env.MAIL_APP_PASSWORD));
}

/** Bases del QR de pago por medio: DEBEN coincidir con PAYMENT_INFO de
    shared/components/PasoPagoTransferencia.tsx (frontend). Al cambiar una,
    cambiar la otra: el QR del correo y el del checkout codifican lo mismo. */
const QR_BASES_PAGO = {
  Nequi: 'nequi://pay/3105551234?name=La%20Sirena%20Pizza',
  Bancolombia: 'https://banco.example.com/pagar?cuenta=690123456789&titular=La%20Sirena%20Pizza%20SAS',
};

/** Payload que codifica el QR: base del medio + valor=<monto>. Si la base ya
    trae "?" se concatena con "&"; si no, con "?" (igual que el frontend). */
function payloadQrPago(tipo, monto) {
  const base = QR_BASES_PAGO[tipo] ?? QR_BASES_PAGO.Nequi;
  return `${base}${base.includes('?') ? '&' : '?'}valor=${monto}`;
}

function obtenerTransporte() {
  if (!transporte) {
    // SMTP configurable por entorno; por defecto Gmail (465/secure).
    const seguro = String(process.env.MAIL_SECURE ?? 'true').toLowerCase() !== 'false';
    transporte = nodemailer.createTransport({
      host: process.env.MAIL_HOST || 'smtp.gmail.com',
      port: Number(process.env.MAIL_PORT) || 465,
      secure: seguro,
      auth: {
        user: process.env.MAIL_USER,
        // MAIL_PASS es el nombre canónico; MAIL_APP_PASSWORD se acepta como
        // alias para no romper el .env existente.
        pass: process.env.MAIL_PASS || process.env.MAIL_APP_PASSWORD,
      },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 10000,
    });
  }
  return transporte;
}

export async function enviarCodigoRecuperacion(correo, nombre, codigo) {
  if (!hayCredenciales()) {
    console.log('Correo no configurado');
    return;
  }

  const primerNombre = String(nombre || '').trim().split(/\s+/)[0] || 'usuario';

  const mail = buildResetEmail({ nombre: primerNombre, codigo, minutos: 15 });

  try {
    await obtenerTransporte().sendMail({
      from: `"Pizzería La Sirena" <${process.env.MAIL_USER}>`,
      replyTo: process.env.MAIL_REPLY_TO || process.env.MAIL_USER,
      to: correo,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      attachments: mail.attachments,
    });
  } catch (error) {
    console.error('Error al enviar correo:', error.code);
  }
}

/**
 * Correo de bienvenida al crear cuenta. Fire-and-forget: captura su propio
 * error y NUNCA lanza, para que el registro no se vea afectado. Éxito y fallo
 * se registran en consola (el fallo incluye el correo destino y el motivo).
 */
export async function enviarCorreoBienvenida(datos) {
  const correo = datos?.correo;
  if (!hayCredenciales()) {
    console.log('Correo no configurado (MAIL_USER / MAIL_PASS): bienvenida omitida');
    return;
  }

  try {
    const mail = buildWelcomeEmail(datos);
    await obtenerTransporte().sendMail({
      from: `"Pizzería La Sirena" <${process.env.MAIL_USER}>`,
      replyTo: process.env.MAIL_REPLY_TO || process.env.MAIL_USER,
      to: correo,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      attachments: mail.attachments,
    });
    console.log(`Correo de bienvenida enviado a ${correo}`);
  } catch (error) {
    console.error(
      `No se pudo enviar el bienvenida a ${correo}: ${error?.code || error?.message || error}`
    );
  }
}

/**
 * Aviso corto de "tu contraseña fue cambiada". Fire-and-forget: captura su
 * propio error y NUNCA lanza, para que el restablecimiento no se vea
 * afectado si el SMTP falla. Éxito y fallo se registran en consola.
 */
export async function enviarAvisoCambioContrasena(datos) {
  const correo = typeof datos?.correo === 'string' ? datos.correo.trim() : '';
  if (!correo) {
    console.error('Aviso de cambio de contraseña omitido: sin correo de destino');
    return;
  }
  if (!hayCredenciales()) {
    console.log('Correo no configurado (MAIL_USER / MAIL_PASS): aviso de cambio omitido');
    return;
  }

  try {
    const mail = buildPasswordChangedEmail(datos);
    await obtenerTransporte().sendMail({
      from: `"Pizzería La Sirena" <${process.env.MAIL_USER}>`,
      replyTo: process.env.MAIL_REPLY_TO || process.env.MAIL_USER,
      to: correo,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      attachments: mail.attachments,
    });
    console.log(`Aviso de cambio de contraseña enviado a ${correo}`);
  } catch (error) {
    console.error(
      `No se pudo enviar el aviso de cambio de contraseña a ${correo}: ${error?.code || error?.message || error}`
    );
  }
}

/**
 * Invitación de empleado (alta de cuenta: el empleado crea su contraseña con el
 * enlace ?activar=<token>). A diferencia del resto de correos, SÍ informa si el
 * envío funcionó: el alta se completa igual y el panel necesita saber si debe
 * mostrar "Empleado creado, pero no se pudo enviar el correo". Nunca lanza.
 * Devuelve true si el correo salió, false en cualquier otro caso.
 */
export async function enviarInvitacionEmpleado(datos) {
  const correo = String(datos?.correo ?? '').trim();
  if (!correo) {
    console.error('Invitación de empleado omitida: sin correo de destino');
    return false;
  }
  if (!hayCredenciales()) {
    console.log('Correo no configurado (MAIL_USER / MAIL_PASS): invitación de empleado omitida');
    return false;
  }

  try {
    const mail = buildInvitacionEmpleadoEmail(datos);
    await obtenerTransporte().sendMail({
      from: `"Pizzería La Sirena" <${process.env.MAIL_USER}>`,
      replyTo: process.env.MAIL_REPLY_TO || process.env.MAIL_USER,
      to: correo,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      attachments: mail.attachments,
    });
    console.log(`Invitación de empleado enviada a ${correo}`);
    return true;
  } catch (error) {
    console.error(
      `No se pudo enviar la invitación de empleado a ${correo}: ${error?.code || error?.message || error}`
    );
    return false;
  }
}

/**
 * "Confirma tu correo" del registro público (enlace ?verificar=<token>). Mismo
 * contrato que enviarInvitacionEmpleado: la cuenta ya quedó creada, así que
 * nunca lanza; devuelve true si el correo salió y false en cualquier otro caso
 * (el cliente puede pedir "Reenviar correo de confirmación" desde el login).
 */
export async function enviarCorreoVerificacion(datos) {
  const correo = String(datos?.correo ?? '').trim();
  if (!correo) {
    console.error('Correo de verificación omitido: sin correo de destino');
    return false;
  }
  if (!hayCredenciales()) {
    console.log('Correo no configurado (MAIL_USER / MAIL_PASS): verificación de correo omitida');
    return false;
  }

  try {
    const mail = buildVerificacionCorreoEmail(datos);
    await obtenerTransporte().sendMail({
      from: `"Pizzería La Sirena" <${process.env.MAIL_USER}>`,
      replyTo: process.env.MAIL_REPLY_TO || process.env.MAIL_USER,
      to: correo,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      attachments: mail.attachments,
    });
    console.log(`Correo de verificación enviado a ${correo}`);
    return true;
  } catch (error) {
    console.error(
      `No se pudo enviar el correo de verificación a ${correo}: ${error?.code || error?.message || error}`
    );
    return false;
  }
}

/**
 * Aviso "ya eres parte del equipo" para quien ya tenía cuenta con contraseña
 * (cliente registrado que acaba de ser contratado). Mismo contrato que
 * enviarInvitacionEmpleado: devuelve true/false y nunca lanza.
 */
export async function enviarAvisoIngresoEquipo(datos) {
  const correo = String(datos?.correo ?? '').trim();
  if (!correo) {
    console.error('Aviso de ingreso al equipo omitido: sin correo de destino');
    return false;
  }
  if (!hayCredenciales()) {
    console.log('Correo no configurado (MAIL_USER / MAIL_PASS): aviso de ingreso al equipo omitido');
    return false;
  }

  try {
    const mail = buildIngresoEquipoEmail(datos);
    await obtenerTransporte().sendMail({
      from: `"Pizzería La Sirena" <${process.env.MAIL_USER}>`,
      replyTo: process.env.MAIL_REPLY_TO || process.env.MAIL_USER,
      to: correo,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      attachments: mail.attachments,
    });
    console.log(`Aviso de ingreso al equipo enviado a ${correo}`);
    return true;
  } catch (error) {
    console.error(
      `No se pudo enviar el aviso de ingreso al equipo a ${correo}: ${error?.code || error?.message || error}`
    );
    return false;
  }
}

export async function enviarAvisoMontoFaltante(datos) {
  const correo = typeof datos?.correo === 'string' ? datos.correo.trim() : '';
  if (!correo) {
    console.error(`Aviso de monto faltante omitido: la venta ${datos?.id ?? '?'} no tiene correo de destino`);
    return;
  }
  if (!hayCredenciales()) {
    console.log('Correo no configurado (MAIL_USER / MAIL_PASS): aviso de saldo omitido');
    return;
  }
  try {
    // QR con los MISMOS datos que codifica el checkout (base del medio de pago
    // + valor=<faltante>). Si la generación falla, el correo sale igual sin QR.
    let qrBuffer = null;
    try {
      qrBuffer = await QRCode.toBuffer(payloadQrPago(datos?.tipo, Number(datos?.faltante) || 0), {
        type: 'png',
        margin: 1,
        width: 260,
        color: { dark: '#141414', light: '#ffffff' },
      });
    } catch (error) {
      console.error(
        `No se pudo generar el QR del aviso de saldo de la venta ${datos?.id ?? '?'}: ${error?.message || error}`
      );
    }
    const mail = buildMontoFaltanteEmail({ ...datos, qrBuffer });
    await obtenerTransporte().sendMail({
      from: `"Pizzería La Sirena" <${process.env.MAIL_USER}>`,
      replyTo: process.env.MAIL_REPLY_TO || process.env.MAIL_USER,
      to: correo,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      attachments: mail.attachments,
    });
    console.log(`Aviso de monto faltante enviado a ${correo}`);
  } catch (error) {
    console.error(`No se pudo enviar aviso de saldo pendiente a ${correo}: ${error?.code || error?.message || error}`);
  }
}

/** Verificación SMTP al arrancar: informa en consola si quedó lista o no,
 *  pero nunca corta el servidor. */
export async function verificarCorreo() {
  if (!hayCredenciales()) {
    console.log('Correo no configurado (MAIL_USER / MAIL_PASS): se omite la verificación SMTP');
    return;
  }
  try {
    await obtenerTransporte().verify();
    console.log('Correo SMTP listo');
  } catch (error) {
    console.error(
      `El correo SMTP no quedó listo: ${error?.code || error?.message || error}`
    );
  }
}
