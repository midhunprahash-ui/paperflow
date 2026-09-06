import { Brand } from "./brand";
export function RouteLoading({ reader = false }: { reader?: boolean }) {
  return <main className={`route-loading${reader ? " route-loading-reader" : ""}`} aria-busy="true"><header><Brand /></header><div className="loading-workspace"><aside aria-hidden="true">{Array.from({ length: 6 }, (_, i) => <span className="skeleton" key={i} />)}</aside><section><p role="status">{reader ? "Opening your paper…" : "Loading your library…"}</p><div className="skeleton skeleton-title" />{Array.from({ length: reader ? 9 : 3 }, (_, i) => <div key={i} className={`skeleton ${reader ? "skeleton-paragraph" : "skeleton-card"}`} />)}</section></div></main>;
}
