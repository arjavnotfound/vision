'use client';

import { useEffect, useRef, useState } from 'react';
import { type VoiceConfig, type VoiceLanguage, getElectron } from '@/lib/electron';
import { cn } from '@/lib/shadcn/utils';
import { DwellTarget } from '../dwell-target';

const LANGUAGES: { value: VoiceLanguage; label: string }[] = [
  { value: 'auto', label: 'Auto-detect' },
  { value: 'en', label: 'English' },
  { value: 'hi', label: 'हिन्दी Hindi' },
];

/** Voice keys, reply language and voice. Changes apply to the next conversation. */
export function VoiceSettings() {
  const [config, setConfig] = useState<VoiceConfig | null>(null);
  const [editingKeys, setEditingKeys] = useState(false);
  const preview = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const electron = getElectron();
    if (!electron?.getVoiceConfig) return;
    void electron.getVoiceConfig().then(setConfig);
    return electron.onVoiceConfigChanged?.((next) =>
      setConfig((current) => (current ? { ...current, ...next } : current))
    );
  }, []);

  if (!config) return null;

  const change = async (next: Partial<Pick<VoiceConfig, 'voice' | 'language'>>) => {
    const saved = await getElectron()?.setVoiceConfig?.(next);
    if (saved) setConfig({ ...config, ...saved });
  };
  const pickVoice = (voice: string) => {
    void change({ voice });
    preview.current?.pause();
    preview.current = new Audio(`/voices/${voice}.wav`);
    void preview.current.play().catch(() => undefined);
  };

  return (
    <section className="bg-ink-1 col-span-2 rounded-[18px] px-6 py-3 shadow-[inset_0_0_0_1px_var(--rule)]">
      <p className="text-bone-3 pt-3 pb-1 font-mono text-[12px] tracking-[0.18em] uppercase">
        Voice
      </p>

      {!config.hasKeys || editingKeys ? (
        <KeysForm
          fields={config.keyFields}
          onSaved={(next) => {
            setConfig(next);
            setEditingKeys(false);
          }}
        />
      ) : (
        <div className="border-rule flex items-center justify-between gap-8 border-b py-4">
          <div>
            <p className="text-bone text-[16px]">Voice keys</p>
            <p className="text-bone-3 mt-1 text-[14px]">Saved, encrypted on this computer.</p>
          </div>
          <DwellTarget
            label="Change voice keys"
            onActivate={() => setEditingKeys(true)}
            indicator="bar"
            hitSize={64}
            className="bg-ink-2 text-bone-2 hover:bg-ink-3 h-16 rounded-[18px] px-5 text-[15px] shadow-[inset_0_0_0_1px_var(--rule)]"
          >
            Change
          </DwellTarget>
        </div>
      )}

      <div className="border-rule border-b py-4">
        <p className="text-bone text-[16px]">Language</p>
        <p className="text-bone-3 mt-1 mb-3 text-[14px]">
          Auto-detect replies in the language you speak, including Hinglish. Say “speak Hindi” or
          “detect my language” to change it by voice.
        </p>
        <div role="radiogroup" aria-label="Language" className="flex gap-3">
          {LANGUAGES.map((option) => (
            <Choice
              key={option.value}
              label={`Language: ${option.label}`}
              active={config.language === option.value}
              onActivate={() => void change({ language: option.value })}
            >
              {option.label}
            </Choice>
          ))}
        </div>
      </div>

      <div className="py-4">
        <p className="text-bone text-[16px]">Voice</p>
        <p className="text-bone-3 mt-1 mb-3 text-[14px]">
          Rest on a voice to hear it. Applies to the next conversation. Say “change your voice” to
          change it by voice.
        </p>
        <div role="radiogroup" aria-label="Voice" className="grid grid-cols-5 gap-3">
          {config.voices.map((voice) => (
            <Choice
              key={voice.name}
              label={`Voice: ${voice.name}, ${voice.style}`}
              active={config.voice === voice.name}
              onActivate={() => pickVoice(voice.name)}
            >
              <span className="flex flex-col items-start leading-tight">
                <span>{voice.name}</span>
                <span className="text-bone-3 text-[12px]">{voice.style}</span>
              </span>
            </Choice>
          ))}
        </div>
      </div>
    </section>
  );
}

function Choice({
  label,
  active,
  onActivate,
  children,
}: {
  label: string;
  active: boolean;
  onActivate: () => void;
  children: React.ReactNode;
}) {
  return (
    <DwellTarget
      label={label}
      pressed={active}
      onActivate={onActivate}
      indicator="bar"
      hitSize={64}
      className={cn(
        'h-16 flex-1 rounded-[18px] px-4 text-left text-[15px] font-medium transition-colors',
        active
          ? 'bg-ember-soft text-bone shadow-[inset_0_0_0_1.5px_var(--ember)]'
          : 'bg-ink-2 text-bone-2 hover:bg-ink-3 hover:text-bone shadow-[inset_0_0_0_1px_var(--rule)]'
      )}
    >
      {children}
    </DwellTarget>
  );
}

function KeysForm({
  fields,
  onSaved,
}: {
  fields: VoiceConfig['keyFields'];
  onSaved: (config: VoiceConfig) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    try {
      const next = await getElectron()?.saveVoiceKeys?.(values);
      if (next) onSaved(next);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message.replace(/^Error invoking remote method '[^']+': /, '')
          : String(e)
      );
    }
  };

  return (
    <div className="border-rule border-b py-4">
      <p className="text-bone text-[16px]">Voice keys</p>
      <p className="text-bone-3 mt-1 mb-3 text-[14px]">
        The voice assistant needs a LiveKit project and a Gemini API key. They are stored encrypted
        on this computer and never leave it except to sign in to those services. Face control works
        without them.
      </p>
      <div className="grid grid-cols-2 gap-3">
        {fields.map((field) => (
          <label key={field.name} className="flex flex-col gap-1">
            <span className="text-bone-2 text-[13px]">{field.label}</span>
            <input
              type={field.secret ? 'password' : 'text'}
              autoComplete="off"
              spellCheck={false}
              value={values[field.name] ?? ''}
              onChange={(e) => setValues({ ...values, [field.name]: e.target.value })}
              className="bg-ink-2 text-bone h-12 rounded-[12px] px-4 font-mono text-[14px] shadow-[inset_0_0_0_1px_var(--rule-strong)] outline-none focus:shadow-[inset_0_0_0_1.5px_var(--ember)]"
            />
          </label>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-4">
        <DwellTarget
          label="Save voice keys"
          onActivate={() => void save()}
          indicator="bar"
          hitSize={64}
          className="bg-ember-soft text-bone h-16 rounded-[18px] px-6 text-[15px] font-medium shadow-[inset_0_0_0_1.5px_var(--ember)]"
        >
          Save keys
        </DwellTarget>
        {error && <p className="text-[14px] text-red-400">{error}</p>}
      </div>
    </div>
  );
}
