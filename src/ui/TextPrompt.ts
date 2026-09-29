import { COLOR, FONT, hex } from './theme.ts';

export interface TextPromptOptions {
  title: string;
  hint?: string;
  placeholder?: string;
  initial?: string;
  maxLength?: number;
  okLabel?: string;
  /** 입력 중 글자 정리 (예: 방 코드 대문자화) */
  transform?: (raw: string) => string;
  /** 확인을 누를 수 있는 값인가 */
  valid?: (value: string) => boolean;
  /** 영문·숫자 코드 입력이면 'code' (자동 대문자·자동완성 끔) */
  kind?: 'text' | 'code';
}

let open: HTMLElement | null = null;

/**
 * 글자 입력 창 (닉네임·방 코드). 캔버스 위에 DOM 입력칸을 띄운다 — 한글 조합·붙여넣기·모바일 키보드를 그대로 쓰기 위해서다.
 * 색·폰트는 DESIGN 토큰. 취소하면 null.
 */
export function askText(opt: TextPromptOptions): Promise<string | null> {
  closeTextPrompt();
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-label', opt.title);
    wrap.style.cssText = `position:fixed;inset:0;z-index:50;display:flex;align-items:center;justify-content:center;background:rgba(8,14,36,.72);font-family:${FONT.body};`;
    const box = document.createElement('div');
    box.style.cssText = `width:min(86vw,420px);padding:22px 20px 18px;border-radius:22px;background:${hex(COLOR.navy)};border:2px solid ${hex(COLOR.modalBorder)};box-shadow:0 6px 0 ${hex(COLOR.navyDark)};color:${hex(COLOR.textMain)};text-align:center;`;
    const h = document.createElement('div');
    h.textContent = opt.title;
    h.style.cssText = `font-family:${FONT.display};font-size:26px;margin-bottom:6px;`;
    const hint = document.createElement('div');
    hint.textContent = opt.hint ?? '';
    hint.style.cssText = `font-size:14px;font-weight:700;color:${hex(COLOR.textSub)};margin-bottom:14px;min-height:18px;`;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = opt.initial ?? '';
    input.placeholder = opt.placeholder ?? '';
    if (opt.maxLength) input.maxLength = opt.maxLength;
    input.autocomplete = 'off';
    input.spellcheck = false;
    if (opt.kind === 'code') { input.autocapitalize = 'characters'; input.inputMode = 'text'; }
    input.setAttribute('aria-label', opt.title);
    input.style.cssText = `box-sizing:border-box;width:100%;padding:12px 14px;border-radius:14px;border:3px solid ${hex(COLOR.navyDark)};background:#fff;color:${hex(COLOR.textOnGold)};font-family:${FONT.display};font-size:${opt.kind === 'code' ? 32 : 24}px;text-align:center;letter-spacing:${opt.kind === 'code' ? '6px' : '0'};outline:none;`;
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:10px;margin-top:16px;';
    const mk = (label: string, bg: number, dark: number, fg: number) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.style.cssText = `flex:1;padding:12px 0;border:0;border-radius:16px;background:${hex(bg)};box-shadow:0 5px 0 ${hex(dark)};color:${hex(fg)};font-family:${FONT.display};font-size:22px;cursor:pointer;`;
      return b;
    };
    const cancel = mk('취소', COLOR.gray, COLOR.grayDark, COLOR.textMain);
    const ok = mk(opt.okLabel ?? '확인', COLOR.gold, COLOR.goldDark, COLOR.textOnGold);
    row.append(cancel, ok);
    box.append(h, hint, input, row);
    wrap.append(box);

    const clean = (v: string) => (opt.transform ? opt.transform(v) : v);
    const isValid = () => (opt.valid ? opt.valid(clean(input.value)) : clean(input.value).trim().length > 0);
    const paint = () => { ok.disabled = !isValid(); ok.style.opacity = ok.disabled ? '0.5' : '1'; };
    const done = (v: string | null) => {
      if (open !== wrap) return;
      closeTextPrompt();
      resolve(v);
    };
    let composing = false;
    input.addEventListener('compositionstart', () => { composing = true; });
    input.addEventListener('compositionend', () => { composing = false; paint(); });
    input.addEventListener('input', () => {
      if (!composing && opt.transform) {
        const v = opt.transform(input.value);
        if (v !== input.value) input.value = v;
      }
      paint();
    });
    input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // 게임 단축키로 새지 않게
      if (e.key === 'Enter' && !composing && isValid()) done(clean(input.value).trim());
      if (e.key === 'Escape') done(null);
    });
    ok.addEventListener('click', () => { if (isValid()) done(clean(input.value).trim()); });
    cancel.addEventListener('click', () => done(null));
    wrap.addEventListener('pointerdown', (e) => { e.stopPropagation(); if (e.target === wrap) done(null); });

    document.body.append(wrap);
    open = wrap;
    paint();
    input.focus();
    input.select();
  });
}

export function closeTextPrompt(): void {
  open?.remove();
  open = null;
}
