import { useState } from 'react';
import { hueOf, platformFamily, PLATFORM_LABELS } from '../lib/games';
import { imgUrl } from '../lib/api';
import type { PlatformId } from '../types';

export interface CaseGame { title: string; cover: string | null; art: string | null; platform?: PlatformId }

/**
 * A game box drawn in CSS 3D from the cover picture: front = the cover, spine = platform colour + title, pages edge on the right.
 * Picture fallbacks: cover -> screenshot -> a generated colour + title, so a box is never empty.
 */
export function GameCase({ game, size = 'md', still }: { game: CaseGame; size?: 'sm' | 'md' | 'lg'; still?: boolean }) {
  const urls = [game.cover, game.art].filter((u): u is string => !!u);
  const [failed, setFailed] = useState(0);
  const idx = Math.min(failed, urls.length);
  const src = idx < urls.length ? imgUrl(urls[idx]) : '';
  const isCover = idx === 0 && !!game.cover;
  const family = game.platform ? platformFamily(game.platform) : 'other';
  const hue = hueOf(game.title);

  return (
    <div className={`case case--${size}${still ? ' case--still' : ''}`} data-family={family}>
      <div className="case__box" style={{ '--hue': hue } as React.CSSProperties}>
        <div className="case__face case__front">
          {src
            ? <img src={src} alt="" loading="lazy" draggable={false} onError={() => setFailed(idx + 1)} />
            : <span className="case__placeholder" aria-hidden="true">{game.title}</span>}
          {!isCover && src && <span className="case__title" aria-hidden="true">{game.title}</span>}
          <span className="case__gloss" aria-hidden="true" />
        </div>
        <div className="case__face case__spine" aria-hidden="true">
          <span className="case__spine-top">{game.platform ? PLATFORM_LABELS[game.platform].split(' ')[0] : ''}</span>
          <span className="case__spine-title">{game.title}</span>
        </div>
        <div className="case__face case__edge" aria-hidden="true" />
        <div className="case__face case__back" aria-hidden="true" />
      </div>
      <div className="case__shadow" aria-hidden="true" />
    </div>
  );
}
