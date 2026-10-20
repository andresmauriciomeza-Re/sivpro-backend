import nodemailer from 'nodemailer';
import {
  buildPasswordChangedEmail,
  buildResetEmail,
  buildWelcomeEmail,
  buildMontoFaltanteEmail,
} from '../utils/emailTemplates.js';

let transporte = null;

function hayCredenciales() {
  return Boolean(process.env.MAIL_USER && (process.env.MAIL_PASS || process.env.MAIL_APP_PASSWORD));
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

export async function enviarAvisoMontoFaltante(datos) {
  const correo = typeof datos?.correo === 'string' ? datos.correo.trim() : '';
  if (!correo) return;
  if (!hayCredenciales()) {
    console.log('Correo no configurado (MAIL_USER / MAIL_PASS): aviso de saldo omitido');
    return;
  }
  try {
    const mail = buildMontoFaltanteEmail(datos);
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
