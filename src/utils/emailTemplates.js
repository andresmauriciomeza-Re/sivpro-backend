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

export function buildResetEmail({ nombre, codigo, minutos = 15 }) {
  const nombreSeguro = escaparHtml(nombre);

  const html = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light only">
  <title>Recupera tu contraseña</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f7;font-family:Arial,Helvetica,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#f4f4f7;">
    Tu código de recuperación es ${codigo}. Vence en ${minutos} minutos.
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f7;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:#ffffff;border-radius:12px;overflow:hidden;">
          <tr>
            <td align="center" style="background-color:#14532d;padding:28px 20px 22px 20px;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" valign="middle" width="110" height="110" style="width:110px;height:110px;background-color:#ffffff;border-radius:55px;">
                    <img src="cid:logo-sivpro" alt="S.I.V.PRO" width="92" height="92" style="display:block;width:92px;height:92px;border:0;margin:0 auto;">
                  </td>
                </tr>
              </table>
              <div style="color:#ffffff;font-size:24px;font-weight:bold;letter-spacing:3px;margin-top:14px;">S.I.V.PRO</div>
              <div style="color:#bbf7d0;font-size:13px;margin-top:4px;">Pizzería La Sirena</div>
            </td>
          </tr>
          <tr>
            <td style="padding:0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td width="50%" style="background-color:#E31E24;height:5px;font-size:0;line-height:0;">&nbsp;</td>
                  <td width="50%" style="background-color:#2E9E3E;height:5px;font-size:0;line-height:0;">&nbsp;</td>
                </tr>
              </table>
            </td>
          </tr>
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
              <p style="margin:0 0 10px 0;font-size:13px;color:#888888;line-height:1.5;">Por tu seguridad, no compartas este código con nadie. El equipo de S.I.V.PRO nunca te lo pedirá.</p>
              <p style="margin:0;font-size:13px;color:#888888;line-height:1.5;">Si no fuiste tú, ignora este mensaje. Tu contraseña no cambiará.</p>
            </td>
          </tr>
          <tr>
            <td align="center" style="background-color:#fafafa;padding:16px;font-size:12px;color:#999999;">
              © S.I.V.PRO · Pizzería La Sirena
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();

  const text = `Hola ${nombre}, tu código para recuperar la contraseña es ${codigo}. Vence en ${minutos} minutos. Si no lo solicitaste, ignora este mensaje.`;

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
