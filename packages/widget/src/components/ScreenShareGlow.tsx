import React from 'react';

export interface ScreenShareGlowProps {
  active: boolean;
  appName: string;
  modeLabel?: string;
}

export function ScreenShareGlow({
  active,
  appName,
  modeLabel = 'Screen Shared',
}: ScreenShareGlowProps) {
  if (!active) return null;

  return (
    <div
      className="aia-live-glow-root"
      data-testid="agent-screen-share-glow"
      role="status"
      aria-live="polite"
      aria-label={`${modeLabel} with ${appName}`}
    >
      <div className="aia-live-glow-aura" />
      <div className="aia-live-glow-border" />
      <div className="aia-live-share-pill" data-testid="agent-screen-share-pill">
        <span className="aia-live-share-orb" aria-hidden="true" />
        <span>{modeLabel}</span>
        <span className="aia-live-share-tag">{appName}</span>
      </div>
    </div>
  );
}
