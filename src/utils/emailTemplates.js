import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RUTA_LOGO = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'assets',
  'logo-blanco.png'
);

function escaparHtml(texto) {
  return String(texto)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Enlace a Google Maps para una dirección, listo para usar en href. */
function urlDeGoogleMaps(direccion) {
  return escaparHtml(
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(direccion)}`
  );
}

/** "604 234 5678" → "6042345678" (valor de href="tel:..."). */
function numeroDeTelefono(telefono) {
  return String(telefono || '').replace(/[^\d+]/g, '');
}

// Color heredado + !important donde Gmail/Apple suelen autodetectar enlaces
// (correo, teléfonos, dirección, fecha) para que nunca se vean en azul.
const envolver = (valor, color) =>
  `<span style="color:${color} !important;">${valor}</span>`;

export function buildResetEmail({ nombre, codigo, minutos = 15 }) {
  const nombreSeguro = escaparHtml(nombre);
  const local = datosDelLocal();

  const html = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light only">
  <title>Tu código de recuperación de S.I.V.PRO</title>
  <style>
    /* Apple Mail / iOS: los detectores de datos no deben pintar de azul
       direcciones, teléfonos ni fechas del correo. */
    a[x-apple-data-detectors] {
      color: inherit !important;
      text-decoration: none !important;
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f7;font-family:Arial,Helvetica,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#f4f4f7;">
    Tu código de recuperación es ${codigo}. Vence en ${minutos} minutos.
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f7;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:#ffffff;border-radius:12px;overflow:hidden;">
          ${encabezadoCompartido()}
          <tr>
            <td style="padding:32px 28px 8px 28px;color:#222222;">
              <h1 style="margin:0 0 12px 0;font-size:22px;">Hola, ${nombreSeguro}</h1>
              <p style="margin:0;font-size:15px;line-height:1.6;color:#555555;">
                Recibimos una solicitud para recuperar tu contraseña. Usa este código para continuar:
              </p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:20px 28px;">
              <div style="display:inline-block;background-color:#f1faf2;border:2px dashed #2E9E3E;border-radius:10px;padding:16px 28px;font-size:34px;font-weight:bold;letter-spacing:10px;color:#E31E24;">
                ${codigo}
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:0 28px 28px 28px;">
              <p style="margin:0 0 10px 0;font-size:14px;color:#555555;">Este código vence en <strong>${minutos} minutos</strong>.</p>
              <p style="margin:0 0 10px 0;font-size:13px;color:#888888;line-height:1.5;">Por tu seguridad, no compartas este código con nadie. El equipo de ${envolver('S.I.V&#8204;.PRO', '#555555')} nunca te lo pedirá.</p>
              <p style="margin:0;font-size:13px;color:#888888;line-height:1.5;">Si no fuiste tú, ignora este mensaje. Tu contraseña no cambiará.</p>
            </td>
          </tr>
          ${pieCompartido()}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();

  const text = [
    `Hola ${nombre}, tu código para recuperar la contraseña es ${codigo}. Vence en ${minutos} minutos. Si no lo solicitaste, ignora este mensaje.`,
    '',
    '© 2026 Pizzería La Sirena · S.I.V.PRO',
    local.direccion,
    'Tus datos se tratan según la Ley 1581 de 2012 (Habeas Data).',
    `Si tienes dudas, responde a este correo o llámanos al ${local.telefono}.`,
  ].join('\n');

  const attachments = [
    {
      filename: 'logo.png',
      path: RUTA_LOGO,
      cid: 'logo-sivpro',
    },
  ];

  return {
    subject: 'Tu código de recuperación de S.I.V.PRO',
    html,
    text,
    attachments,
  };
}

// ─────────────────────────── BIENVENIDA (registro de cliente) ───────────────────────────

/** Etiquetas de tipo de documento (mismas del frontend: CC/CE/PP). */
const ETIQUETAS_DOCUMENTO = {
  CC: 'Cédula de Ciudadanía',
  CE: 'Cédula de Extranjería',
  Pasaporte: 'Pasaporte',
};

/** "1234567890" → "****7890" (nunca se muestra el documento completo). */
function enmascararDocumento(numero) {
  const texto = String(numero ?? '');
  return texto.length <= 4 ? '****' : `****${texto.slice(-4)}`;
}

/** "queiner" → "Queiner", "MARÍA" → "María" (saludo del correo). */
function aCapitalo(texto) {
  const t = String(texto || '').trim();
  if (!t) return t;
  return t.charAt(0).toLocaleUpperCase('es') + t.slice(1).toLocaleLowerCase('es');
}

/** "17 de octubre de 2026, 11:09 p. m." en zona horaria America/Bogota. */
function formatearFechaBogota(fecha = new Date()) {
  const opciones = { timeZone: 'America/Bogota' };
  const dia = new Intl.DateTimeFormat('es-CO', { ...opciones, day: 'numeric' }).format(fecha);
  const mes = new Intl.DateTimeFormat('es-CO', { ...opciones, month: 'long' }).format(fecha);
  const anio = new Intl.DateTimeFormat('es-CO', { ...opciones, year: 'numeric' }).format(fecha);
  const hora = new Intl.DateTimeFormat('es-CO', {
    ...opciones,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
    .format(fecha)
    // Intl puede usar espacio fino (U+202F/U+00A0) antes de a. m./p. m.
    .replace(/[\u202F\u00A0]/g, ' ')
    .replace(/\bAM\b/i, 'a. m.')
    .replace(/\bPM\b/i, 'p. m.');
  return `${dia} de ${mes} de ${anio}, ${hora}`;
}

/** Datos del local, configurables por entorno y con los valores de la Landing. */
function datosDelLocal() {
  return {
    direccion:
      process.env.LOCAL_DIRECCION || 'Cra. 45 #104-30, Laureles, Medellín, Antioquia',
    horario:
      process.env.LOCAL_HORARIO || 'Jueves a domingo, 4:00 p. m. a 10:00 p. m.',
    telefono: process.env.LOCAL_TELEFONO || '604 234 5678',
  };
}

/** URL del frontend, sin barra final (encabezado y pie). */
function urlDelFrontend() {
  return (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/+$/, '');
}

export function buildMontoFaltanteEmail({ id, nombre, total, pagado, faltante }) {
  const nombreCompleto = String(nombre || '').trim() || 'cliente';
  const nombreSeguro = escaparHtml(nombreCompleto);
  const numeroVenta = escaparHtml(id);
  const totalTexto = new Intl.NumberFormat('es-CO', {
    style: 'currency', currency: 'COP', maximumFractionDigits: 0,
  }).format(Number(total) || 0);
  const pagadoTexto = new Intl.NumberFormat('es-CO', {
    style: 'currency', currency: 'COP', maximumFractionDigits: 0,
  }).format(Number(pagado) || 0);
  const faltanteTexto = new Intl.NumberFormat('es-CO', {
    style: 'currency', currency: 'COP', maximumFractionDigits: 0,
  }).format(Number(faltante) || 0);
  const urlPedidos = urlDelFrontend().split(',')[0].trim().replace(/\/+$/, '');
  const urlPedidosSegura = escaparHtml(urlPedidos);
  const local = datosDelLocal();
  const telefonoSeguro = escaparHtml(local.telefono);
  const telefonoHref = numeroDeTelefono(local.telefono);
  const subject = `Tu pedido #${id} tiene un saldo pendiente de ${faltanteTexto}`;
  const html = `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="color-scheme" content="light only"><title>${escaparHtml(subject)}</title></head>
<body style="margin:0;padding:0;background-color:#f4f4f7;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f7;padding:24px 12px;"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#ffffff;border-radius:12px;overflow:hidden;">
      ${encabezadoCompartido()}
      <tr><td style="padding:32px 28px 8px;color:#222222;">
        <h1 style="margin:0 0 12px;font-size:22px;">Hola ${nombreSeguro},</h1>
        <p style="margin:0;font-size:15px;line-height:1.6;color:#555555;">Revisamos el pago de tu pedido #${numeroVenta} y el valor recibido es menor al total del pedido.</p>
      </td></tr>
      <tr><td style="padding:16px 28px 8px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eeeeee;border-radius:10px;border-collapse:collapse;background-color:#fafafa;">
        <tr><td style="padding:10px 14px;font-size:14px;color:#555555;border-bottom:1px solid #eeeeee;">Total del pedido</td><td align="right" style="padding:10px 14px;font-size:14px;color:#222222;border-bottom:1px solid #eeeeee;"><strong>${escaparHtml(totalTexto)}</strong></td></tr>
        <tr><td style="padding:10px 14px;font-size:14px;color:#555555;border-bottom:1px solid #eeeeee;">Valor recibido</td><td align="right" style="padding:10px 14px;font-size:14px;color:#222222;border-bottom:1px solid #eeeeee;">${escaparHtml(pagadoTexto)}</td></tr>
        <tr><td style="padding:10px 14px;font-size:14px;color:#555555;">Saldo pendiente</td><td align="right" style="padding:10px 14px;font-size:14px;color:#222222;"><strong>${escaparHtml(faltanteTexto)}</strong></td></tr>
      </table></td></tr>
      <tr><td style="padding:12px 28px;color:#555555;font-size:14px;line-height:1.7;">
        <p>Para continuar, envía el saldo pendiente por el mismo medio de pago que usaste y sube el comprobante en la sección "Mis pedidos".</p>
        <p style="text-align:center;padding:8px 0 12px;"><a href="${urlPedidosSegura}" style="display:inline-block;background-color:#2E9E3E;color:#ffffff !important;font-size:15px;font-weight:bold;text-decoration:none !important;padding:14px 28px;border-radius:9px;">Subir comprobante</a></p>
        <p>Tu pedido queda en espera hasta que recibamos el comprobante. Cuando lo verifiquemos, continuaremos con tu pedido.</p>
        <p>Si ya hiciste el pago o tienes alguna duda, comunícate con nosotros al <a href="tel:${telefonoHref}" style="color:#555555 !important;text-decoration:none !important;">${telefonoSeguro}</a>.</p>
        <p>Gracias por elegir Pizzería La Sirena.</p>
      </td></tr>
      ${pieCompartido()}
    </table>
  </td></tr></table>
</body></html>`.trim();
  const text = [
    `Hola ${nombreCompleto},`, '',
    `Revisamos el pago de tu pedido #${id} y el valor recibido es menor al total del pedido.`, '',
    `Total del pedido: ${totalTexto}`,
    `Valor recibido: ${pagadoTexto}`,
    `Saldo pendiente: ${faltanteTexto}`, '',
    'Para continuar, envía el saldo pendiente por el mismo medio de pago que usaste y sube el comprobante en la sección "Mis pedidos".',
    `Subir comprobante: ${urlPedidos}`, '',
    'Tu pedido queda en espera hasta que recibamos el comprobante. Cuando lo verifiquemos, continuaremos con tu pedido.', '',
    `Si ya hiciste el pago o tienes alguna duda, comunícate con nosotros al ${local.telefono}.`, '',
    'Gracias por elegir Pizzería La Sirena.',
  ].join('\n');
  return {
    subject,
    html,
    text,
    attachments: [{ filename: 'logo.png', path: RUTA_LOGO, cid: 'logo-sivpro' }],
  };
}

// ─────────────────────── ENCABEZADO Y PIE COMPARTIDOS ───────────────────────
// Los 3 correos (bienvenida, código de recuperación y contraseña cambiada)
// usan EXACTAMENTE este encabezado y este pie: fondo verde oscuro #14532d
// (el mismo del correo del código), logo por cid, "S.I.V.PRO" en blanco y
// franja verde #2E9E3E que se distingue sobre el fondo. Ningún texto azul:
// todo enlace lleva color heredado con !important y text-decoration:none.

/** Encabezado compartido (filas <tr> listas para la tarjeta blanca). */
function encabezadoCompartido() {
  const urlSegura = escaparHtml(urlDelFrontend());
  return `
          <tr>
            <td align="center" style="background-color:#14532d;padding:28px 20px 22px 20px;">
              <img src="cid:logo-sivpro" alt="S.I.V.PRO - Pizzería La Sirena" width="130" height="130" style="display:block;margin:0 auto;width:130px;height:130px;border:0;outline:none;text-decoration:none;border-radius:50%;">
              <a href="${urlSegura}" style="color:#ffffff !important;text-decoration:none !important;display:inline-block;font-size:24px;font-weight:bold;letter-spacing:3px;margin-top:14px;">S.I.V.PRO</a>
              <div style="color:#bbf7d0;font-size:13px;margin-top:4px;">Pizzería La Sirena</div>
            </td>
          </tr>
          <tr>
            <td style="padding:0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background-color:#2E9E3E;height:5px;font-size:0;line-height:0;">&nbsp;</td>
                </tr>
              </table>
            </td>
          </tr>`;
}

/** Pie compartido (fila <tr> lista): nombre, dirección y contacto. */
function pieCompartido() {
  const local = datosDelLocal();
  const urlMaps = urlDeGoogleMaps(local.direccion);
  const telLocal = numeroDeTelefono(local.telefono);
  const direccionSegura = escaparHtml(local.direccion);
  const telefonoSeguro = escaparHtml(local.telefono);
  const urlSegura = escaparHtml(urlDelFrontend());
  return `
          <tr>
            <td align="center" style="background-color:#fafafa;padding:16px;font-size:12px;color:#999999;">
              <p style="margin:0;font-size:12px;line-height:1.7;color:#999999;">
                © 2026 Pizzería La Sirena · <a href="${urlSegura}" style="color:#999999 !important;text-decoration:none !important;">S.I.V.PRO</a><br>
                <a href="${urlMaps}" style="color:#999999 !important;text-decoration:none !important;">${direccionSegura}</a><br>
                Tus datos se tratan según la Ley 1581 de 2012 (Habeas Data).<br>
                Si tienes dudas, responde a este correo o llámanos al <a href="tel:${telLocal}" style="color:#999999 !important;text-decoration:none !important;">${telefonoSeguro}</a>.
              </p>
            </td>
          </tr>`;
}

const PASOS_PEDIDO = [
  'Elige tus pizzas, lasañas o bebidas en nuestra página.',
  'Realiza el pago anticipado por Nequi o Bancolombia y sube el comprobante.',
  'Verificamos tu pago y preparamos tu pedido.',
  'Recógelo en nuestro local. (No realizamos domicilios.)',
];

/** Correo de bienvenida al registrarse. Recibe SOLO datos públicos del perfil
 *  (nunca la contraseña) y escapa todo lo que se inserta en el HTML. */
export function buildWelcomeEmail(datos) {
  const nombre = String(datos?.nombre || '').trim() || 'cliente';
  const correo = String(datos?.correo || '').trim();
  const telefono = String(datos?.telefono || '').trim();
  const tipoDocumento = String(datos?.tipoDocumento || '').trim();
  const numeroDocumento = String(datos?.numeroDocumento || '').trim();

  const primerNombre = aCapitalo(nombre.split(/\s+/)[0]) || 'cliente';
  const etiquetaTipo =
    ETIQUETAS_DOCUMENTO[tipoDocumento] || tipoDocumento || '—';
  const documentoMostrado = numeroDocumento
    ? `${etiquetaTipo} ${enmascararDocumento(numeroDocumento)}`
    : '—';
  const fechaRegistro = datos?.fechaRegistro || formatearFechaBogota();
  const accesoAdmin = datos?.creadoPorAdmin === true
    ? '<p style="margin:0 0 16px;color:#3f3f46;line-height:1.7;">Para entrar, usa <strong>¿Olvidaste tu contraseña?</strong> en el inicio de sesión para crear tu contraseña.</p>'
    : '';
  const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/+$/, '');
  const local = datosDelLocal();

  // Todo dato de usuario pasa por escaparHtml antes de entrar al HTML.
  const nombreSeguro = escaparHtml(nombre);
  const primerNombreSeguro = escaparHtml(primerNombre);
  const correoSeguro = escaparHtml(correo);
  const telefonoSeguro = escaparHtml(telefono || '—');
  const documentoSeguro = escaparHtml(documentoMostrado);
  const fechaSegura = escaparHtml(fechaRegistro);
  const urlSegura = escaparHtml(frontendUrl);
  const direccionSegura = escaparHtml(local.direccion);
  const horarioSegura = escaparHtml(local.horario);
  const telefonoLocalSeguro = escaparHtml(local.telefono);
  const urlMaps = urlDeGoogleMaps(local.direccion);
  const telLocal = numeroDeTelefono(local.telefono);
  const telUsuario = telefono
    ? `<a href="tel:${numeroDeTelefono(telefono)}" style="color:#222222 !important;text-decoration:none !important;">${telefonoSeguro}</a>`
    : telefonoSeguro;

  const filaResumen = (etiqueta, valor, ultima = false) => {
    const borde = ultima ? '' : 'border-bottom:1px solid #eeeeee;';
    return `
            <tr>
              <td style="padding:10px 14px;font-size:14px;color:#777777;${borde}white-space:nowrap;">
                <strong>${etiqueta}</strong>
              </td>
              <td style="padding:10px 14px;font-size:14px;color:#222222;${borde}">
                ${valor}
              </td>
            </tr>`;
  };

  const filasPasos = PASOS_PEDIDO.map(
    (paso, i) => `
            <tr>
              <td width="34" valign="top" style="padding:6px 10px 6px 0;">
                <div style="width:26px;height:26px;line-height:26px;border-radius:50%;background-color:#2E9E3E;color:#ffffff;font-size:14px;font-weight:bold;text-align:center;">${i + 1}</div>
              </td>
              <td valign="top" style="padding:8px 0;font-size:14px;line-height:1.5;color:#444444;">
                ${escaparHtml(paso)}
              </td>
            </tr>`
  ).join('');

  const html = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light only">
  <title>Bienvenido a Pizzería La Sirena, tu cuenta fue creada</title>
  <style>
    /* Apple Mail / iOS: los detectores de datos no deben pintar de azul
       direcciones, teléfonos ni fechas del correo. */
    a[x-apple-data-detectors] {
      color: inherit !important;
      text-decoration: none !important;
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f7;font-family:Arial,Helvetica,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#f4f4f7;">
    Tu cuenta en Pizzería La Sirena fue creada. Ya puedes hacer tu primer pedido.
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f7;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#ffffff;border-radius:12px;overflow:hidden;">
          ${encabezadoCompartido()}
          <tr>
            <td style="padding:32px 28px 6px 28px;color:#222222;">
              <h1 style="margin:0 0 10px 0;font-size:22px;">¡Hola, ${primerNombreSeguro}!</h1>
              <p style="margin:0;font-size:15px;line-height:1.6;color:#555555;">
                Tu cuenta en <strong>Pizzería La Sirena</strong> se creó exitosamente. Ya puedes ordenar tus pizzas, lasañas y bebidas favoritas.
              </p>
              ${accesoAdmin}
            </td>
          </tr>
          <tr>
            <td style="padding:16px 28px 4px 28px;">
              <p style="margin:0 0 8px 0;font-size:16px;font-weight:bold;color:#222222;">Resumen de la cuenta</p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eeeeee;border-radius:10px;border-collapse:collapse;background-color:#fafafa;">
                ${filaResumen('Nombre completo', nombreSeguro)}
                ${filaResumen(
                  'Correo',
                  `<a href="mailto:${correoSeguro}" style="color:#222222 !important;text-decoration:none !important;">${correoSeguro}</a>`
                )}
                ${filaResumen('Documento', documentoSeguro)}
                ${filaResumen('Teléfono', telUsuario)}
                ${filaResumen('Fecha de registro', envolver(fechaSegura, '#222222'), true)}
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:22px 28px 4px 28px;">
              <p style="margin:0 0 6px 0;font-size:16px;font-weight:bold;color:#222222;">¿Cómo hacer tu pedido?</p>
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                ${filasPasos}
              </table>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:24px 28px 8px 28px;">
              <a href="${urlSegura}" style="display:inline-block;background-color:#2E9E3E;color:#ffffff !important;font-size:16px;font-weight:bold;text-decoration:none !important;padding:16px 34px;border-radius:10px;">Hacer mi primer pedido</a>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 28px 6px 28px;">
              <p style="margin:0 0 8px 0;font-size:16px;font-weight:bold;color:#222222;">Datos de nuestro local</p>
              <p style="margin:0 0 6px 0;font-size:14px;line-height:1.6;color:#555555;">
                <strong>Dirección:</strong> <a href="${urlMaps}" style="color:#222222 !important;text-decoration:none !important;">${direccionSegura}</a><br>
                <strong>Horario:</strong> ${envolver(horarioSegura, '#555555')}<br>
                <strong>Teléfono:</strong> <a href="tel:${telLocal}" style="color:#555555 !important;text-decoration:none !important;">${telefonoLocalSeguro}</a>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:14px 28px 4px 28px;">
              <p style="margin:0;font-size:13px;line-height:1.5;color:#888888;background-color:#fff8e6;border:1px solid #f5e3b3;border-radius:8px;padding:12px 14px;">
                <strong>Nota de seguridad:</strong> si no creaste esta cuenta, ignora este correo o escríbenos. Nunca te pediremos tu contraseña.
              </p>
            </td>
          </tr>
          ${pieCompartido()}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();

  const text = [
    '¡Bienvenido a Pizzería La Sirena!',
    '',
    `¡Hola, ${primerNombre}!`,
    'Tu cuenta en Pizzería La Sirena se creó exitosamente.',
    '',
    'Resumen de la cuenta',
    `- Nombre completo: ${nombre}`,
    `- Correo: ${correo}`,
    `- Documento: ${documentoMostrado}`,
    `- Teléfono: ${telefono || '—'}`,
    `- Fecha de registro: ${fechaRegistro}`,
    '',
    '¿Cómo hacer tu pedido?',
    ...PASOS_PEDIDO.map((paso, i) => `${i + 1}. ${paso}`),
    '',
    ...(datos?.creadoPorAdmin ? ['Para entrar, usa “¿Olvidaste tu contraseña?” en el inicio de sesión.'] : []),
    `Hacer mi primer pedido: ${frontendUrl}`,
    '',
    'Datos de nuestro local',
    `- Dirección: ${local.direccion}`,
    `- Horario: ${local.horario}`,
    `- Teléfono: ${local.telefono}`,
    '',
    'Nota de seguridad: si no creaste esta cuenta, ignora este correo o escríbenos. Nunca te pediremos tu contraseña.',
    '',
    '© 2026 Pizzería La Sirena · S.I.V.PRO',
    local.direccion,
    'Tus datos se tratan según la Ley 1581 de 2012 (Habeas Data).',
    `Si tienes dudas, responde a este correo o llámanos al ${local.telefono}.`,
  ].join('\n');

  const attachments = [
    {
      filename: 'logo.png',
      path: RUTA_LOGO,
      cid: 'logo-sivpro',
    },
  ];

  return {
    subject: 'Bienvenido a Pizzería La Sirena, tu cuenta fue creada',
    html,
    text,
    attachments,
  };
}

// ─────────────────────────── AVISO DE CAMBIO DE CONTRASEÑA ───────────────────────────

/**
 * Correo de confirmación cuando el usuario cambia su contraseña
 * (POST /auth/recuperar/restablecer). Mismo aspecto que la bienvenida:
 * logo (cid), encabezado y pie COMPARTIDOS y tarjeta blanca con la misma
 * medida. La fecha NO lleva punto añadido: "…11:29 a. m." ya cierra la
 * frase (antes salía "a. m.." con el punto extra del template).
 */
export function buildPasswordChangedEmail({ nombre, fecha } = {}) {
  const nombreSeguro = escaparHtml(nombre || 'usuario');
  const fechaTexto = escaparHtml(fecha || formatearFechaBogota());
  const local = datosDelLocal();
  const telefono = escaparHtml(local.telefono);
  const telLocal = numeroDeTelefono(local.telefono);

  const html = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light only">
  <title>Tu contraseña de S.I.V.PRO fue cambiada</title>
  <style>
    /* Apple Mail / iOS: los detectores de datos no deben pintar de azul
       direcciones, teléfonos ni fechas del correo. */
    a[x-apple-data-detectors] {
      color: inherit !important;
      text-decoration: none !important;
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f7;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f7;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#ffffff;border-radius:12px;overflow:hidden;">
          ${encabezadoCompartido()}
          <tr>
            <td style="padding:32px 28px 8px 28px;color:#222222;">
              <h1 style="margin:0 0 12px 0;font-size:22px;">Tu contraseña de <span style="color:#222222 !important;text-decoration:none !important;">S.I.V&#8204;.PRO</span> fue cambiada</h1>
              <p style="margin:0 0 10px 0;font-size:15px;line-height:1.6;color:#555555;">
                Hola, ${nombreSeguro}. Confirmamos que la contraseña de tu cuenta fue cambiada el ${fechaTexto}
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:4px 28px 4px 28px;">
              <p style="margin:0;font-size:14px;color:#555555;line-height:1.5;">
                <strong>Si no fuiste tú, contáctanos de inmediato</strong> al <a href="tel:${telLocal}" style="color:#555555 !important;text-decoration:none !important;">${telefono}</a>.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:14px 28px 4px 28px;">
              <p style="margin:0;font-size:13px;line-height:1.5;color:#888888;background-color:#fff8e6;border:1px solid #f5e3b3;border-radius:8px;padding:12px 14px;">
                <strong>Nota de seguridad:</strong> si no cambiaste tu contraseña, ignora este correo o escríbenos. Nunca te pediremos tu contraseña.
              </p>
            </td>
          </tr>
          ${pieCompartido()}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();

  const text = [
    `Hola ${nombre}, tu contraseña de S.I.V.PRO fue cambiada el ${fechaTexto}`,
    '',
    `Si no fuiste tú, contáctanos de inmediato al ${local.telefono}.`,
    '',
    '© 2026 Pizzería La Sirena · S.I.V.PRO',
    local.direccion,
    'Tus datos se tratan según la Ley 1581 de 2012 (Habeas Data).',
    `Si tienes dudas, responde a este correo o llámanos al ${local.telefono}.`,
  ].join('\n');

  const attachments = [
    {
      filename: 'logo.png',
      path: RUTA_LOGO,
      cid: 'logo-sivpro',
    },
  ];

  return {
    subject: 'Tu contraseña de S.I.V.PRO fue cambiada',
    html,
    text,
    attachments,
  };
}
