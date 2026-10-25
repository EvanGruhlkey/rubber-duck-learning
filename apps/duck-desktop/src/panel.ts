import { currentMonitor, getCurrentWindow, PhysicalPosition, PhysicalSize } from "@tauri-apps/api/window";

interface Rect { x: number; y: number; width: number; height: number }
export function panelBounds(current: Rect, work: Rect, scale: number, open: boolean): Rect {
  const width = Math.min(work.width, Math.round((open ? 400 : 120) * scale));
  const height = Math.min(work.height, Math.round((open ? 620 : 120) * scale));
  return {
    x: Math.max(work.x, Math.min(current.x + (current.width - width) / 2, work.x + work.width - width)),
    y: Math.max(work.y, Math.min(current.y + current.height - height, work.y + work.height - height)),
    width, height,
  };
}

let queue = Promise.resolve();
export function resizePanel(open: boolean): Promise<void> {
  queue = queue.catch(() => {}).then(async () => {
    const window = getCurrentWindow();
    const [position, size, monitor, scale] = await Promise.all([window.outerPosition(), window.outerSize(), currentMonitor(), window.scaleFactor()]);
    if (!monitor) return;
    const next = panelBounds({ ...position, ...size }, { ...monitor.workArea.position, ...monitor.workArea.size }, scale, open);
    await window.setSize(new PhysicalSize(next.width, next.height));
    await window.setPosition(new PhysicalPosition(Math.round(next.x), Math.round(next.y)));
  });
  return queue;
}
