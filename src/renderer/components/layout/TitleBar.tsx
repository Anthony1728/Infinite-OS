import { InfiniteLogo } from '../brand/InfiniteLogo';

export function TitleBar() {
  return (
    <header
      className="os-window-titlebar"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      onDoubleClick={() => void window.api.windowMaximize()}
    >
      <div className="os-window-drag-end" />
      <div className="os-window-title"><InfiniteLogo className="h-3.5 w-6" animated /><span>Infinite OS</span></div>
      <div className="os-traffic-lights" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <button className="os-window-control os-window-minimize" onClick={(event) => { event.stopPropagation(); void window.api.windowMinimize(); }} aria-label="Minimize window"><svg className="os-window-icon" viewBox="0 0 10 10" aria-hidden="true"><rect x="1.5" y="4.5" width="7" height="1" fill="currentColor" /></svg></button>
        <button className="os-window-control os-window-maximize" onClick={(event) => { event.stopPropagation(); void window.api.windowMaximize(); }} aria-label="Maximize or restore window"><svg className="os-window-icon" viewBox="0 0 10 10" aria-hidden="true"><path d="M2.2 4.1V2.2h1.9M7.8 5.9v1.9H5.9M4.1 7.8H2.2V5.9M5.9 2.2h1.9v1.9" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
        <button className="os-window-control os-window-close" onClick={(event) => { event.stopPropagation(); void window.api.windowClose(); }} aria-label="Close window"><svg className="os-window-icon" viewBox="0 0 10 10" aria-hidden="true"><path d="M3 3l4 4M7 3l-4 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg></button>
      </div>
    </header>
  );
}
