import { useRef, useState } from 'react';
import { Tooltip } from './common';

const DATA_KEYS = [
  'savings-params',
  'savings-initial-inputs',
  'retirement-params',
  'affordability-params',
  'nestegg-investments-v1',
  'nestegg-prices-v1',
  'nestegg-tab',
];

function readData(): { [key: string]: unknown } {
  const data: { [key: string]: unknown } = {};
  for (const key of DATA_KEYS) {
    const raw = localStorage.getItem(key);
    if (raw !== null) {
      try {
        data[key] = JSON.parse(raw);
      } catch {
        data[key] = raw;
      }
    }
  }
  return data;
}

interface Feedback {
  kind: 'success' | 'warning' | 'error';
  text: string;
}

export default function BackupRestore() {
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = () => {
    const payload = { app: 'nestegg', version: 1, exportedAt: new Date().toISOString(), data: readData() };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nestegg-copia-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setFeedback({ kind: 'success', text: 'Copia descargada. Guárdala en un lugar seguro.' });
  };

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const payload = JSON.parse(String(reader.result));
        const data = payload?.data ?? payload;
        if (typeof data !== 'object' || data === null) {
          throw new Error('Formato no reconocido');
        }
        let count = 0;
        for (const key of Object.keys(data)) {
          if (!DATA_KEYS.includes(key)) continue;
          localStorage.setItem(key, JSON.stringify(data[key]));
          count += 1;
        }
        if (count === 0) {
          setFeedback({ kind: 'warning', text: 'El fichero no contiene datos de NestEgg reconocibles.' });
          return;
        }
        setFeedback({ kind: 'success', text: `Datos restaurados (${count} secciones). Recargando…` });
        setTimeout(() => window.location.reload(), 900);
      } catch {
        setFeedback({ kind: 'error', text: 'No se pudo leer el fichero. ¿Es una copia de NestEgg?' });
      }
    };
    reader.readAsText(file);
  };

  return (
    <>
      <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2">
        {open && (
          <div className="bg-white border border-gray-200 rounded-xl shadow-lg p-4 w-72 text-sm">
            <p className="font-semibold text-gray-900 mb-1.5">Copia de seguridad</p>
            <p className="text-xs text-gray-500 leading-relaxed mb-4">
              Descarga tus datos guardados en este navegador o restaura una copia previa en otro dispositivo.
            </p>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={handleExport}
                className="px-4 py-2 rounded-lg bg-gray-900 text-white text-sm font-semibold hover:bg-gray-700 transition-colors cursor-pointer"
              >
                ⬇️ Descargar copia
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="px-4 py-2 rounded-lg border border-gray-200 text-gray-900 text-sm font-semibold hover:bg-gray-50 transition-colors cursor-pointer"
              >
                ⬆️ Restaurar copia
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={e => handleFile(e.target.files?.[0])}
              />
            </div>
            {feedback && (
              <p className={`mt-3 text-xs leading-relaxed ${
                feedback.kind === 'success' ? 'text-emerald-700'
                  : feedback.kind === 'warning' ? 'text-amber-700'
                  : 'text-red-700'
              }`}>
                {feedback.text}
              </p>
            )}
          </div>
        )}
        <Tooltip text="Copiar o restaurar datos">
          <button
            type="button"
            onClick={() => { setOpen(o => !o); setFeedback(null); }}
            aria-label="Copia de seguridad de tus datos"
            className="w-12 h-12 flex items-center justify-center rounded-full bg-gray-900 text-white text-xl shadow-lg hover:bg-gray-700 transition-colors cursor-pointer"
          >
            💾
          </button>
        </Tooltip>
      </div>
    </>
  );
}
