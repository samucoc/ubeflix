import { useEffect } from 'react';

// Sondeo que sólo trabaja cuando hace falta.
//
// Los paneles de descargas consultaban al servidor cada 2-5 segundos de forma
// incondicional: con la pestaña de fondo, y aunque no hubiera ninguna descarga
// en curso. Este hook:
//   - pausa mientras la pestaña está oculta (y consulta al volver),
//   - usa `interval` cuando hay algo activo e `idleInterval` cuando no,
//   - encadena con setTimeout, así una respuesta lenta no apila peticiones.
//
//   usePolling(load, { interval: 2000, idleInterval: 15000, active: hayDescargas });
//
// `idleInterval: null` deja de consultar del todo mientras no haya actividad.
// Memoizá `callback` con useCallback: al cambiar de identidad se reinicia el ciclo.
export default function usePolling(
  callback,
  { interval = 5000, idleInterval = interval, active = true, enabled = true } = {}
) {
  useEffect(() => {
    if (!enabled) return undefined;

    const delay = active ? interval : idleInterval;
    let cancelled = false;
    let timer = null;

    const schedule = () => {
      if (cancelled || delay == null) return;
      timer = setTimeout(run, delay);
    };

    const run = async () => {
      if (cancelled) return;
      // Con la pestaña oculta no hay nada que actualizar en pantalla.
      if (typeof document !== 'undefined' && document.hidden) {
        schedule();
        return;
      }
      try {
        await callback();
      } catch {
        // El llamador decide qué hacer con los errores; acá sólo seguimos.
      }
      schedule();
    };

    // Primera pasada inmediata, y otra al volver a la pestaña.
    run();

    const onVisibilityChange = () => {
      if (!document.hidden) run();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [callback, interval, idleInterval, active, enabled]);
}
