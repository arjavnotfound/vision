'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { type ActivityItem, actionVerb, domainOf, relativeTime } from '@/lib/activity';
import { cn } from '@/lib/shadcn/utils';
import { actionIcon } from '../primitives';

function useNow(interval = 5000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(id);
  }, [interval]);
  return now;
}

function Favicon({ item }: { item: ActivityItem }) {
  const domain = domainOf(item);
  const [failed, setFailed] = useState(false);
  const Icon = actionIcon(item.action);
  return (
    <span className="bg-ink-2 grid size-10 shrink-0 place-items-center overflow-hidden rounded-[12px] shadow-[inset_0_0_0_1px_var(--rule)]">
      {domain && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`}
          alt=""
          width={20}
          height={20}
          className="size-5"
          onError={() => setFailed(true)}
        />
      ) : (
        <Icon className="text-bone-2 size-[18px]" strokeWidth={1.8} />
      )}
    </span>
  );
}

export function ActivityRow({
  item,
  latest,
  now,
  detailed = false,
}: {
  item: ActivityItem;
  latest: boolean;
  now: number;
  detailed?: boolean;
}) {
  const domain = domainOf(item);
  const target = item.action === 'open_url' && domain ? domain : item.target || domain;
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: -12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0 }}
      transition={{ type: 'spring', stiffness: 400, damping: 34 }}
      className={cn(
        'relative flex items-center gap-3.5 rounded-[14px] px-3 py-2.5',
        latest && 'bg-ink-2 shadow-[inset_0_0_0_1px_var(--rule)]'
      )}
    >
      {latest && (
        <span
          className="bg-ember absolute top-3 bottom-3 left-0 w-[2px] rounded-full"
          aria-hidden
        />
      )}
      <Favicon item={item} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'text-[13px] font-medium',
              item.status === 'error' ? 'text-err' : latest ? 'text-ember-text' : 'text-bone-3'
            )}
          >
            {item.status === 'error' ? 'Failed' : actionVerb(item.action)}
          </span>
          {item.status === 'running' && (
            <span
              className="bg-ember size-1.5 animate-pulse rounded-full"
              aria-label="In progress"
            />
          )}
        </div>
        <p className={cn('truncate text-[15px]', latest ? 'text-bone' : 'text-bone-2')}>
          {target || '—'}
        </p>
        {detailed && (item.title || item.error) && (
          <p className="text-bone-3 mt-0.5 truncate text-[13px]">{item.error ?? item.title}</p>
        )}
      </div>
      <span className="text-bone-3 shrink-0 self-start pt-0.5 text-[13px] tabular-nums">
        {relativeTime(item.ts, now)}
      </span>
    </motion.li>
  );
}

export function ActivityTimeline({
  items,
  limit = 7,
  detailed = false,
  className,
}: {
  items: ActivityItem[];
  limit?: number;
  detailed?: boolean;
  className?: string;
}) {
  const now = useNow();
  const visible = items.slice(0, limit);
  if (!visible.length) {
    return (
      <div className={cn('flex flex-col items-start gap-2 px-3 py-4', className)}>
        <p className="text-bone-2 text-[15px]">Nothing yet.</p>
        <p className="text-bone-3 text-[14px] leading-relaxed">
          Sites VISION opens and things it clicks will appear here.
        </p>
      </div>
    );
  }
  return (
    <ul className={cn('flex flex-col gap-1', className)}>
      <AnimatePresence initial={false}>
        {visible.map((item, index) => (
          <ActivityRow
            key={item.id}
            item={item}
            latest={index === 0}
            now={now}
            detailed={detailed}
          />
        ))}
      </AnimatePresence>
    </ul>
  );
}
