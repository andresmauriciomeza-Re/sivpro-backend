import nodemailer from 'nodemailer';
import { buildResetEmail } from '../utils/emailTemplates.js';

let transporte = null;

function obtenerTransporte() {
  if (!transporte) {
    transporte = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: {
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_APP_PASSWORD,
      },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 10000,
    });
  }
  return transporte;
}

export async function enviarCodigoRecuperacion(correo, nombre, codigo) {
  if (!process.env.MAIL_USER || !process.env.MAIL_APP_PASSWORD) {
    console.log('Correo no configurado');
    return;
  }

  const primerNombre = String(nombre || '').trim().split(/\s+/)[0] || 'usuario';

  const mail = buildResetEmail({ nombre: primerNombre, codigo, minutos: 15 });

  try {
    await obtenerTransporte().sendMail({
      from: `"S.I.V.PRO La Sirena" <${process.env.MAIL_USER}>`,
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
