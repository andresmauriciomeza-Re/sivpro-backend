const relojBogota = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const mesBogota = new Intl.DateTimeFormat('es-CO', {
  timeZone: 'America/Bogota', month: 'long',
});

function fechaEnBogota(valor) {
  if (valor instanceof Date) return valor;
  const iso = valor.replace(' ', 'T');
  return new Date(/[zZ]$|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : iso + '-05:00');
}

function partesBogota(fecha) {
  return Object.fromEntries(relojBogota.formatToParts(fecha).map(({ type, value }) => [type, value]));
}

export function formatearHora(valor) {
  if (!valor) return '';
  if (typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}[T ]/.test(valor.trim())) {
    return formatearHora(fechaEnBogota(valor.trim()));
  }
  let hora;
  let minuto;
  if (valor instanceof Date) {
    if (Number.isNaN(valor.getTime())) return '';
    ({ hour: hora, minute: minuto } = partesBogota(valor));
  } else {
    const texto = valor.trim();
    const partes = /^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?\s*(a\.?\s*m\.?|p\.?\s*m\.?)?$/i.exec(texto);
    if (!partes) return texto;
    [, hora, minuto] = partes;
    const periodo = partes[3]?.toLowerCase()[0];
    if (periodo && Number(hora) >= 1 && Number(hora) <= 12) {
      hora = Number(hora) % 12 + (periodo === 'p' ? 12 : 0);
    }
    if (Number(hora) > 23 || Number(minuto) > 59) return texto;
  }
  return `${Number(hora) % 12 || 12}:${minuto} ${Number(hora) >= 12 ? 'p. m.' : 'a. m.'}`;
}

export function formatearFechaHora(valor = new Date(), { fechaLarga = false } = {}) {
  if (!valor) return '';
  const texto = typeof valor === 'string' ? valor.trim() : '';
  const conBarras = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(.+))?$/.exec(texto);
  const sinHora = /^\d{4}-\d{2}-\d{2}$/.test(texto) || (conBarras && !conBarras[4]);
  const iso = conBarras
    ? `${conBarras[3]}-${conBarras[2].padStart(2, '0')}-${conBarras[1].padStart(2, '0')}`
    : texto;
  const fecha = fechaEnBogota(sinHora || conBarras ? iso + 'T00:00:00' : texto || valor);
  if (Number.isNaN(fecha.getTime())) {
    // Las entradas ya escritas como fecha larga pueden incluir una hora al final.
    return texto.replace(/(\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]\.?\s*m\.?)?)$/i, formatearHora);
  }
  const { day, month, year } = partesBogota(fecha);
  const fechaTexto = fechaLarga
    ? `${Number(day)} de ${mesBogota.format(fecha)} de ${year}`
    : `${day}/${month}/${year}`;
  if (sinHora) return fechaTexto;
  const hora = formatearHora(conBarras ? conBarras[4] : fecha);
  return fechaTexto + (fechaLarga ? ', ' : ' ') + hora;
}
