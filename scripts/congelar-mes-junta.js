// Corre automáticamente (vía tarea programada) la madrugada del día 1 de cada mes: calcula los
// indicadores de La Junta del mes que acaba de terminar y los guarda como una foto fija en
// junta_indicadores_congelados. Una vez guardada, ese mes nunca se vuelve a recalcular en la app,
// sin importar qué pase después con tareas reabiertas — ver JuntaIndicadoresTab en src/App.jsx.
//
// Usa la llave pública (anon) de Supabase — la misma que ya usa la app en el navegador de
// cualquiera que la visite, protegida por las políticas de la base de datos (RLS), no un secreto.
//
// Uso: node scripts/congelar-mes-junta.js
// Variables de entorno opcionales (si no se pasan, usa las de este archivo/.env del proyecto):
//   SUPABASE_URL, SUPABASE_ANON_KEY

const SUPABASE_URL = process.env.SUPABASE_URL || "https://rutxarnhdabeteyunhjd.supabase.co";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ1dHhhcm5oZGFiZXRleXVuaGpkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4MDM4NzAsImV4cCI6MjA5NDM3OTg3MH0.6xyG25G9ppKxhlhFgwyJFQLpsqBcEHJqNY_CyiZXbts";

// ── Mismas funciones de fecha/cálculo que src/App.jsx (martesDelMes, tareaVencidaNoRealizada,
// mesDeCierre, statsDelMes) — se duplican aquí a propósito para que este script no dependa de
// importar el bundle de la app, y así sea robusto sin importar cómo cambie el resto del código.
const toColombiaDate = (d = new Date()) => new Date(d.toLocaleString("en-US", { timeZone: "America/Bogota" }));
const fmt = (d) => { const c = toColombiaDate(d); return `${c.getFullYear()}-${String(c.getMonth()+1).padStart(2,"0")}-${String(c.getDate()).padStart(2,"0")}`; };
const sumarDias = (fechaStr, n) => fmt(new Date(new Date(fechaStr+"T12:00:00").getTime() + n*86400000));
const martesDelMes = (anio, mes) => {
  const dias = [];
  const d = new Date(anio, mes, 1, 12);
  while (d.getMonth() === mes) {
    if (d.getDay() === 2) dias.push(fmt(d));
    d.setDate(d.getDate() + 1);
  }
  return dias;
};
const domingoDeLaSemana = (martesStr) => sumarDias(martesStr, 5);
const tareaVencidaNoRealizada = (t, todayStr) => !t.completado && !!t.fecha_estimada && todayStr > domingoDeLaSemana(t.fecha_estimada);
const mesDeCierre = (t, todayStr) => {
  if (t.completado) return (t.completado_en ? fmt(new Date(t.completado_en)) : t.semana || "").slice(0,7) || null;
  if (tareaVencidaNoRealizada(t, todayStr)) return (t.fecha_estimada || t.semana || "").slice(0,7) || null;
  return null;
};
const statsDelMes = (compromisos, anio, mes, todayStr) => {
  const martes = martesDelMes(anio, mes);
  const mesStr = `${anio}-${String(mes+1).padStart(2,"0")}`;
  const tareas = compromisos.filter(c => martes.includes(c.semana));
  const sesiones = new Set(tareas.map(t => t.semana)).size;
  const cerradas = compromisos.filter(c => mesDeCierre(c, todayStr) === mesStr);
  const completadas = cerradas.filter(t => t.completado).length;
  const pct = cerradas.length ? Math.round((completadas / cerradas.length) * 100) : null;
  return { totalMartes: martes.length, sesiones, totalTareas: tareas.length, completadas, totalCerradas: cerradas.length, pct };
};
const statsPorLiderDelMes = (compromisos, lideres, anio, mes, todayStr) => {
  const martes = martesDelMes(anio, mes);
  const mesStr = `${anio}-${String(mes+1).padStart(2,"0")}`;
  const tareas = compromisos.filter(c => martes.includes(c.semana));
  const cerradasMes = compromisos.filter(c => mesDeCierre(c, todayStr) === mesStr);
  return lideres
    .map(l => {
      const deLider = tareas.filter(t => t.lider_id === l.id);
      const cerradasLider = cerradasMes.filter(t => t.lider_id === l.id);
      const completadas = cerradasLider.filter(t => t.completado).length;
      const pct = cerradasLider.length ? Math.round((completadas / cerradasLider.length) * 100) : null;
      return { lider_id: l.id, nombre: l.nombre, total: deLider.length, completadas, totalCerradas: cerradasLider.length, pct };
    })
    .filter(x => x.total > 0 || x.totalCerradas > 0);
};

async function main() {
  const headers = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };
  const ahoraCol = toColombiaDate();
  // El mes que acaba de terminar: el mes anterior al actual (este script corre el día 1 de cada
  // mes, así que "el mes anterior a hoy" es siempre el que se acaba de cerrar).
  let anio = ahoraCol.getFullYear(), mes = ahoraCol.getMonth() - 1;
  if (mes < 0) { mes = 11; anio -= 1; }
  const todayStr = fmt(new Date());

  const checkRes = await fetch(`${SUPABASE_URL}/rest/v1/junta_indicadores_congelados?anio=eq.${anio}&mes=eq.${mes+1}&select=id`, { headers });
  const existentes = await checkRes.json();
  if (Array.isArray(existentes) && existentes.length > 0) {
    console.log(`Ya existe una foto para ${anio}-${String(mes+1).padStart(2,"0")} — no se hace nada (nunca se recalcula).`);
    return;
  }

  const compRes = await fetch(`${SUPABASE_URL}/rest/v1/junta_compromisos?select=*`, { headers });
  const compromisos = await compRes.json();
  if (!Array.isArray(compromisos)) throw new Error("No se pudo leer junta_compromisos: " + JSON.stringify(compromisos));

  const lidRes = await fetch(`${SUPABASE_URL}/rest/v1/junta_lideres?select=*`, { headers });
  const lideres = await lidRes.json();
  if (!Array.isArray(lideres)) throw new Error("No se pudo leer junta_lideres: " + JSON.stringify(lideres));

  const s = statsDelMes(compromisos, anio, mes, todayStr);
  const porLider = statsPorLiderDelMes(compromisos, lideres, anio, mes, todayStr);

  const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/junta_indicadores_congelados`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({
      anio, mes: mes+1, sesiones: s.sesiones, total_martes: s.totalMartes, total_tareas: s.totalTareas,
      completadas: s.completadas, total_cerradas: s.totalCerradas, pct: s.pct, congelado_por: "tarea automática",
      por_lider: porLider,
    }),
  });
  const insertData = await insertRes.json();
  if (!insertRes.ok) throw new Error("No se pudo guardar la foto: " + JSON.stringify(insertData));
  console.log(`Foto guardada para ${anio}-${String(mes+1).padStart(2,"0")}:`, insertData);
}

main().catch(e => { console.error(e); process.exit(1); });
