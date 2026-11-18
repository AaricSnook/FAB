import { type CSSProperties, forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import { DotMatrixController, type DotMatrixOptions } from '../core/controller';
import { type SvgToBitmapOptions, svgToBitmap } from '../core/svg';

export interface DotMatrixProps extends Partial<DotMatrixOptions> {
  /** Text to show. Use `\n` for more lines. Lowercase is shown as uppercase. */
  value?: string | number;
  /**
   * SVG markup to show instead of text. It's drawn onto the grid at `cols` × `rows`
   * dots (or `cols` square on the circle layout; 24 if unset).
   */
  svg?: string;
  /** How the SVG becomes dots. */
  svgOptions?: Omit<SvgToBitmapOptions, 'cols' | 'rows'>;
  /** Called if the SVG can't be read or drawn. */
  onSvgError?: (error: Error) => void;
  /** Accessible name. Defaults to the text; give one for an SVG. */
  label?: string;
  /** Announce changes to screen readers (for live stats). */
  live?: boolean;
  className?: string;
  style?: CSSProperties;
}

export interface DotMatrixHandle {
  /** Replay the current transition from blank. */
  replay(): void;
  controller: DotMatrixController | null;
}

const srOnly: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
};

/**
 * Animated dot-matrix display for text or SVG icons.
 *
 * <DotMatrix value="128.4 KM" transition="count" cols={48} align="right" />
 * <DotMatrix svg={bikeIcon} layout="circle" cols={32} label="Cycling" />
 */
export const DotMatrix = forwardRef<DotMatrixHandle, DotMatrixProps>(function DotMatrix(
  { value = '', svg, svgOptions, onSvgError, label, live = false, className, style, ...options },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctrl = useRef<DotMatrixController | null>(null);
  const text = String(value);
  const lastBitmap = useRef<Parameters<DotMatrixController['setBitmap']>[0] | null>(null);

  // Options are compared by value, so inline objects don't cause redraws.
  const optionsKey = JSON.stringify(options);
  const svgKey = JSON.stringify([svg, svgOptions, options.cols, options.rows, options.layout]);
  const pictureKey = JSON.stringify([svg, svgOptions]);
  const lastPicture = useRef<string | null>(null);

  useLayoutEffect(() => {
    ctrl.current = new DotMatrixController(canvasRef.current!, options, svg ? '' : text);
    return () => {
      ctrl.current?.destroy();
      ctrl.current = null;
    };
    // Created once; later changes flow through the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) return;
    ctrl.current?.setOptions(options);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optionsKey]);

  useEffect(() => {
    if (svg) return;
    lastBitmap.current = null;
    lastPicture.current = null;
    if (!mounted.current) return;
    ctrl.current?.setText(text, undefined, true);
  }, [text, svg]);

  // Rasterise the SVG whenever it or the grid changes. The first one appears without a transition.
  useEffect(() => {
    if (!svg) return;
    let cancelled = false;
    // Animate when the picture itself changes; a resize or relayout just redraws.
    const animate = mounted.current && lastPicture.current !== pictureKey;
    lastPicture.current = pictureKey;
    const cols = options.cols ?? 24;
    const round = options.layout === 'circle';
    const rows = round ? cols : options.rows ?? cols;
    // On a round face, fit the picture inside the circle: the largest square that fits leaves ~15% each side.
    const padding = round ? Math.max(svgOptions?.padding ?? 0, Math.round(cols * 0.15)) : svgOptions?.padding;
    svgToBitmap(svg, { ...svgOptions, padding, cols, rows })
      .then((bmp) => {
        if (cancelled || !ctrl.current) return;
        ctrl.current.setBitmap(bmp, animate ? undefined : 'none');
        lastBitmap.current = bmp;
      })
      .catch((e: Error) => !cancelled && onSvgError?.(e));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [svgKey]);

  useEffect(() => {
    mounted.current = true;
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      replay() {
        const c = ctrl.current;
        if (!c) return;
        c.setText('', 'none', true);
        if (svg && lastBitmap.current) c.setBitmap(lastBitmap.current);
        else c.setText(text, undefined, true);
      },
      get controller() {
        return ctrl.current;
      },
    }),
    [text, svg],
  );

  const name = label ?? (svg ? 'Icon' : text);
  return (
    <span className={className} style={{ display: 'inline-block', position: 'relative', lineHeight: 0, ...style }}>
      <canvas ref={canvasRef} role="img" aria-label={name} style={{ display: 'block', maxWidth: '100%', height: 'auto' }} />
      {live && (
        <span aria-live="polite" style={srOnly}>
          {name}
        </span>
      )}
    </span>
  );
});
