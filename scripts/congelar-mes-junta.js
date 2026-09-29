// Corre automáticamente (vía tarea programada) TODAS LAS MADRUGADAS: calcula los indicadores de
// La Junta del mes que ya terminó y los guarda como una foto fija en junta_indicadores_congelados
// — pero solo el día en que ese mes realmente termina de verdad. Como se trabaja por semanas
// (lunes a domingo, martes-anchored) aunque el indicador se fije por mes, el mes "termina" cuando
// pasa el domingo de su ÚLTIMA semana — que casi siempre cae unos días DESPUÉS del último día del
// mes calendario (ej.: si el último martes de septiembre es el 29, esa semana no cierra hasta el
// domingo 4 de octubre). Por eso corre todos los días y se pregunta "¿ya pasó ese domingo?" en vez
// de asumir una fecha fija — así nunca se congela un mes antes de que su última semana haya
// tenido oportunidad de cerrarse (completada o vencida). Una vez guardada la foto, ese mes nunca
// se vuelve a recalcular en la app, sin importar qué pase después con tareas reabiertas — ver
// JuntaIndicadoresTab en src/App.jsx. Si el monitor de la última semana ya hizo el corte a mano
// con el botón "Congelar este mes ahora", este script simplemente no hace nada ese mes (ya existe
// la foto).
//
// Usa la llave pública (anon) de Supabase — la misma que ya usa la app en el navegador de
// cualquiera que la visite, protegida por las políticas de la base de datos (RLS), no un secreto.
//
// Uso: node scripts/congelar-mes-junta.js
// Variables de entorno opcionales (si no se pasan, usa las de este archivo/.env del proyecto):
//   SUPABASE_URL, SUPABASE_ANON_KEY

const SUPABASE_URL = process.env.SUPABASE_URL || "https://crlyzeusnbtvhwkrhcle.supabase.co";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNybHl6ZXVzbmJ0dmh3a3JoY2xlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ1NzAyNTYsImV4cCI6MjEwMDE0NjI1Nn0.LUKSZa0DkTyCesAKpiewURHQ9ovGAw9Wx-oUjgia9vU";

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
// Reapertura "tardía" = la tarea ya estaba vencida (pasado el domingo de su plazo anterior) en el
// momento exacto en que se reabrió — igual que en src/App.jsx (tuvoReaperturaTardia). Si pasó al
// menos una vez, aunque termine cumplida, no cuenta como "a tiempo".
const tuvoReaperturaTardia = (t) => (t.reaperturas||[]).some(r => r.fecha_anterior && r.en && fmt(new Date(r.en)) > domingoDeLaSemana(r.fecha_anterior));
const cumplidaATiempo = (t) => !!t.completado && !tuvoReaperturaTardia(t);
const statsDelMes = (compromisos, anio, mes, todayStr) => {
  const martes = martesDelMes(anio, mes);
  const mesStr = `${anio}-${String(mes+1).padStart(2,"0")}`;
  const tareas = compromisos.filter(c => martes.includes(c.semana));
  const sesiones = new Set(tareas.map(t => t.semana)).size;
  const cerradas = compromisos.filter(c => mesDeCierre(c, todayStr) === mesStr);
  const completadas = cerradas.filter(t => t.completado).length;
  const completadasATiempo = cerradas.filter(cumplidaATiempo).length;
  const pct = cerradas.length ? Math.round((completadas / cerradas.length) * 100) : null;
  const pctATiempo = cerradas.length ? Math.round((completadasATiempo / cerradas.length) * 100) : null;
  return { totalMartes: martes.length, sesiones, totalTareas: tareas.length, completadas, completadasATiempo, totalCerradas: cerradas.length, pct, pctATiempo };
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
      const completadasATiempo = cerradasLider.filter(cumplidaATiempo).length;
      const pct = cerradasLider.length ? Math.round((completadas / cerradasLider.length) * 100) : null;
      const pctATiempo = cerradasLider.length ? Math.round((completadasATiempo / cerradasLider.length) * 100) : null;
      return { lider_id: l.id, nombre: l.nombre, total: deLider.length, completadas, completadasATiempo, totalCerradas: cerradasLider.length, pct, pctATiempo };
    })
    .filter(x => x.total > 0 || x.totalCerradas > 0);
};

async function main() {
  const headers = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };
  const ahoraCol = toColombiaDate();
  // Mes candidato a congelar: el mes anterior al actual (nunca se congela el mes en curso).
  let anio = ahoraCol.getFullYear(), mes = ahoraCol.getMonth() - 1;
  if (mes < 0) { mes = 11; anio -= 1; }
  const todayStr = fmt(new Date());

  // ¿Ya pasó el domingo de la ÚLTIMA semana de ese mes? Si no, todavía no ha "terminado" de
  // verdad (puede que su última semana siga en curso, con tareas activas que aún tienen plazo
  // hasta ese domingo) — se sale sin hacer nada y se vuelve a intentar la próxima madrugada.
  const martesDelMesCandidato = martesDelMes(anio, mes);
  const ultimoMartes = martesDelMesCandidato[martesDelMesCandidato.length - 1];
  const limiteReal = ultimoMartes ? domingoDeLaSemana(ultimoMartes) : `${anio}-${String(mes+1).padStart(2,"0")}-28`;
  if (todayStr <= limiteReal) {
    console.log(`${anio}-${String(mes+1).padStart(2,"0")} todavía no termina de verdad (su última semana vence el ${limiteReal}) — no se hace nada hoy.`);
    return;
  }

  const checkRes = await fetch(`${SUPABASE_URL}/rest/v1/junta_indicadores_congelados?anio=eq.${anio}&mes=eq.${mes+1}&select=id`, { headers });
  const existentes = await checkRes.json();
  if (Array.isArray(existentes) && existentes.length > 0) {
    console.log(`Ya existe una foto para ${anio}-${String(mes+1).padStart(2,"0")} — no se hace nada (nunca se recalcula, puede que el monitor ya la haya congelado a mano).`);
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
      completadas: s.completadas, completadas_a_tiempo: s.completadasATiempo, total_cerradas: s.totalCerradas, pct: s.pct, pct_a_tiempo: s.pctATiempo, congelado_por: "tarea automática",
      por_lider: porLider,
    }),
  });
  const insertData = await insertRes.json();
  if (!insertRes.ok) throw new Error("No se pudo guardar la foto: " + JSON.stringify(insertData));
  console.log(`Foto guardada para ${anio}-${String(mes+1).padStart(2,"0")}:`, insertData);
}

main().catch(e => { console.error(e); process.exit(1); });
