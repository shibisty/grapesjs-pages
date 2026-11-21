import { mediaCss } from './media';
export const STYLE_ID = 'gjsp-style';

export const CSS = `
.gjsp{display:flex;flex-direction:column;min-height:100%;font-size:13px;text-align:start;font-family:var(--gjs-main-font,Helvetica,sans-serif)}
.gjsp[hidden]{display:none !important}
.gjsp-head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:4px 6px;padding:8px 10px;border-bottom:1px solid rgba(0,0,0,.25);font-weight:600}
.gjsp-title{flex:1 0 auto;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gjsp-tools{display:flex;gap:2px;flex-shrink:0}
.gjsp-btn{background:none;border:0;color:inherit;cursor:pointer;padding:4px 7px;border-radius:3px;font-size:15px;line-height:1}
.gjsp-btn:hover{background:rgba(255,255,255,.12)}
.gjsp-btn[disabled]{opacity:.3;cursor:default;background:none}
.gjsp-status{padding:6px 10px;font-size:11px;opacity:.7;min-height:16px;word-break:break-all}
.gjsp-list{list-style:none;margin:0;padding:0;overflow:auto}
.gjsp-item{display:flex;align-items:center;gap:8px;padding:8px 10px;cursor:pointer;border-left:3px solid transparent}
.gjsp[dir=rtl] .gjsp-item{border-left:0;border-right:3px solid transparent}
.gjsp-item:hover,.gjsp-item:focus-visible{background:rgba(255,255,255,.06);outline:none}
.gjsp-item.is-active{background:rgba(255,255,255,.1);border-left-color:var(--gjs-quaternary-color,#d278c9)}
.gjsp[dir=rtl] .gjsp-item.is-active{border-right-color:var(--gjs-quaternary-color,#d278c9)}
.gjsp-dot{font-size:9px;opacity:0;color:var(--gjs-quaternary-color,#d278c9)}
.gjsp-dot.is-dirty{opacity:1}
.gjsp:not(.has-server) .gjsp-dot{display:none}
.gjsp-main{flex:1;min-width:0}
.gjsp-name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gjsp-sub{font-size:10px;opacity:.55}
.gjsp-acts{display:flex;align-items:center;gap:1px;flex:none}
.gjsp-more{background:none;border:0;color:inherit;cursor:pointer;padding:0 5px;border-radius:3px;font-size:15px;line-height:20px;visibility:hidden}
.gjsp-item:hover .gjsp-more,.gjsp-item:focus-within .gjsp-more,.gjsp-item.has-menu .gjsp-more{visibility:visible}
.gjsp-more:hover,.gjsp-item.has-menu .gjsp-more{background:rgba(255,255,255,.15)}
.gjsp-act{background:none;border:0;color:inherit;cursor:pointer;padding:2px 5px;border-radius:3px;font-size:13px}
.gjsp-act:hover{background:rgba(255,255,255,.15)}
.gjsp-act__label{display:none}
.gjsp-menu{position:fixed;z-index:10001;min-width:170px;padding:4px;border-radius:6px;background:var(--gjs-primary-color,#444);color:var(--gjs-font-color,#ddd);box-shadow:0 6px 24px rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.08);display:flex;flex-direction:column}
.gjsp-menu[hidden]{display:none}
.gjsp-menu .gjsp-act{display:flex;align-items:center;gap:8px;width:100%;text-align:start;padding:6px 8px;font-size:12px;white-space:nowrap}
.gjsp-menu .gjsp-act__icon{width:16px;text-align:center;flex:none}
.gjsp-menu .gjsp-act__label{display:inline}
.gjsp-menu .gjsp-act:focus-visible{outline:1px solid var(--gjs-color-highlight,#71b7f1)}
.gjsp-modal{font-size:13px}
.gjsp-modal label{display:block}
.gjsp-modal table{width:100%;border-collapse:collapse;margin:8px 0}
.gjsp-modal td{padding:6px 4px;border-bottom:1px solid rgba(255,255,255,.1);vertical-align:middle}
.gjsp-modal small{opacity:.6;display:block}
.gjsp-input,.gjsp-modal select{width:100%;box-sizing:border-box;padding:6px 8px;margin:4px 0 10px;background:rgba(0,0,0,.25);border:1px solid rgba(255,255,255,.2);color:inherit;border-radius:3px}
.gjsp-modal select{margin:0}
.gjsp-modal select option{color:#222}
.gjsp-primary,.gjsp-secondary{padding:7px 14px;border-radius:3px;border:0;cursor:pointer;margin-inline-end:6px;color:inherit}
.gjsp-primary{background:var(--gjs-quaternary-color,#d278c9)}
.gjsp-secondary{background:rgba(255,255,255,.15)}
.gjsp-primary[disabled]{opacity:.5;cursor:default}
.gjsp-msg{margin:6px 0;min-height:18px}
.gjsp-err{color:#ff8a80}
.gjsp.gjsp-inline{width:100%;height:100%;overflow:hidden;background:var(--gjs-primary-color,#444)}
.gjsp.gjsp-floating{position:absolute;top:0;right:0;bottom:0;width:280px;z-index:50;box-shadow:-2px 0 8px rgba(0,0,0,.35);background:var(--gjs-primary-color,#444)}
.gjsp-toggle{position:absolute;top:8px;right:8px;z-index:60;background:var(--gjs-primary-color,#444);color:var(--gjs-font-color,#ddd);border:1px solid rgba(255,255,255,.2);border-radius:4px;padding:6px 10px;cursor:pointer;font-size:12px;box-shadow:0 1px 4px rgba(0,0,0,.3)}
.gjsp-toggle:hover{background:rgba(255,255,255,.12)}
.gjsp-searchbox{padding:0 10px 6px}
.gjsp-search{width:100%;box-sizing:border-box;padding:5px 8px;background:rgba(0,0,0,.25);border:1px solid rgba(255,255,255,.15);border-radius:3px;color:inherit;font:inherit}
.gjsp-search:focus{outline:none;border-color:var(--gjs-quaternary-color,#d278c9)}
.gjsp-empty{padding:10px;opacity:.6;font-size:12px}
.gjsp-item.is-context .gjsp-name{opacity:.55}
.gjsp-item.is-match .gjsp-name{font-weight:600}
.gjsp-twisty{background:none;border:0;color:inherit;cursor:pointer;width:14px;padding:0;margin-inline-end:-4px;font-size:10px;opacity:.7;flex-shrink:0}
.gjsp-twisty[disabled]{cursor:default;opacity:0}
.gjsp-item[draggable=true]{cursor:grab}
.gjsp-item.is-dragging{opacity:.4}
.gjsp-item.drop-before{box-shadow:inset 0 2px 0 var(--gjs-quaternary-color,#d278c9)}
.gjsp-item.drop-after{box-shadow:inset 0 -2px 0 var(--gjs-quaternary-color,#d278c9)}
.gjsp-item.drop-inside{background:rgba(210,120,201,.18);outline:1px dashed var(--gjs-quaternary-color,#d278c9);outline-offset:-2px}
.gjsp-section{display:flex;align-items:center;justify-content:space-between;padding:10px 10px 4px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;opacity:.65;cursor:default}
.gjsp-section .gjsp-act{font-size:15px;opacity:1}
.gjsp-item.has-conflict .gjsp-sub{color:#ffb74d;opacity:.9}
.gjsp-import{padding:10px}
.gjsp-check{display:flex;align-items:center;gap:6px;margin:4px 0 10px}
.gjsp-tabs{display:flex;gap:2px;margin:0 0 12px;border-bottom:1px solid rgba(255,255,255,.15)}
.gjsp-tab{background:none;border:0;border-bottom:2px solid transparent;color:inherit;opacity:.7;cursor:pointer;padding:6px 12px;font:inherit;margin-bottom:-1px}
.gjsp-tab:hover{opacity:1}
.gjsp-tab.is-active{opacity:1;border-bottom-color:var(--gjs-quaternary-color,#d278c9)}
.gjsp-tab-pane[hidden]{display:none}
.gjsp-item.is-data .gjsp-name{opacity:.9}
.gjsp-data-icon{opacity:.6}
.gjsp-choices{display:flex;flex-direction:column;gap:6px;margin:10px 0}
.gjsp-choices button{text-align:start}
.gjsp-select{width:100%;box-sizing:border-box;padding:6px 8px;margin:4px 0 10px;background:rgba(0,0,0,.25);border:1px solid rgba(255,255,255,.2);color:inherit;border-radius:3px}
.gjsp-toggle.gjsp-btn-inline{position:static;box-shadow:none;padding:5px;border:0;border-radius:0;background:transparent}
.gjsp-component-bar{position:absolute;top:8px;left:50%;transform:translateX(-50%);z-index:20;display:flex;align-items:center;gap:10px;max-width:calc(100% - 24px);padding:6px 12px;border-radius:16px;background:var(--gjs-quaternary-color,#d278c9);color:#fff;font:12px/1.4 var(--gjs-main-font,Helvetica,sans-serif);box-shadow:0 1px 6px rgba(0,0,0,.3)}
.gjsp-component-bar span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gjsp-component-back{flex-shrink:0;border:0;border-radius:10px;padding:3px 9px;background:rgba(0,0,0,.25);color:inherit;font:inherit;cursor:pointer}
.gjsp-component-back:hover{background:rgba(0,0,0,.4)}
.gjsp-seo{max-width:640px}
.gjsp-seo-field{display:block;margin:0 0 2px}
.gjsp-seo-label{display:block;font-size:12px;opacity:.85}
.gjsp-seo-hint{display:block;font-size:11px;opacity:.6;margin:-6px 0 10px}
p.gjsp-seo-hint{margin:0 0 10px}
.gjsp-seo-count{display:block;text-align:end;font-size:11px;opacity:.6;margin:-8px 0 8px}
.gjsp-seo-count.is-over{color:#ff8a80;opacity:1}
.gjsp-seo-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 10px}
.gjsp-seo-row{display:flex;flex-wrap:wrap;gap:4px;margin:-4px 0 10px}
.gjsp-seo-row .gjsp-secondary{margin:0;padding:5px 10px}
.gjsp-seo-media .gjsp-input{margin-bottom:6px}
.gjsp-seo-thumb{display:block;max-width:100%;max-height:120px;object-fit:contain;border-radius:3px;margin:4px 0;background:rgba(255,255,255,.06)}
.gjsp-seo-thumb[hidden]{display:none}
.gjsp-seo-warn{color:#ffb74d;font-size:12px;margin:-4px 0 10px}
.gjsp-seo-warn[hidden]{display:none}
.gjsp-seo-err{display:block;color:#ff8a80;font-size:12px;margin:-6px 0 8px}
.gjsp-seo-snippet,.gjsp-seo-card{background:#fff;color:#202124;border-radius:6px;padding:10px 12px;margin:0 0 12px;font-family:Arial,sans-serif;max-width:600px}
.gjsp-seo-snippet-url{font-size:12px;color:#4d5156;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gjsp-seo-snippet-title{font-size:18px;color:#1a0dab;line-height:1.3;margin:2px 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gjsp-seo-snippet-desc{font-size:13px;line-height:1.45;color:#4d5156;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.gjsp-seo-card{padding:0;overflow:hidden;border:1px solid #dadde1}
.gjsp-seo-card-img{display:block;width:100%;aspect-ratio:1.91/1;object-fit:cover;background:#e4e6eb}
.gjsp-seo-card-img.is-empty{aspect-ratio:auto;height:44px}
.gjsp-seo-card-host,.gjsp-seo-card-title,.gjsp-seo-card-desc{padding:0 12px}
.gjsp-seo-card-host{font-size:12px;color:#606770;text-transform:uppercase;padding-top:8px}
.gjsp-seo-card-title{font-size:16px;font-weight:600;color:#1d2129;margin:2px 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gjsp-seo-card-desc{font-size:13px;color:#606770;padding-bottom:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gjsp-seo-qa{display:grid;grid-template-columns:1fr auto;gap:0 6px;align-items:start;border:1px solid rgba(255,255,255,.12);border-radius:4px;padding:6px 6px 0;margin-bottom:6px}
.gjsp-seo-qa textarea{grid-column:1}
.gjsp-seo-qa .gjsp-act{grid-row:1;grid-column:2}
.gjsp-code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px}
.gjsp-seo-out summary{cursor:pointer;opacity:.85;margin:4px 0}
.gjsp-seo-ld{max-height:260px;overflow:auto;background:rgba(0,0,0,.25);padding:8px;border-radius:3px;white-space:pre-wrap;word-break:break-word;margin:4px 0 10px}
.gjsp-trait{width:100%;padding:4px 2px 8px;box-sizing:border-box;text-align:start;font-size:12px}
.gjsp-trait__head{display:flex;align-items:center;gap:6px;margin:0 0 8px}
.gjsp-trait__title{flex:1;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gjsp-trait__btns{display:flex;flex-wrap:wrap;gap:6px}
.gjsp-trait__btns button{margin:0;padding:5px 10px}
.gjsp-trait .gjsp-primary{color:#fff}
.gjsp-trait__ok{margin-inline-start:6px;color:#81c784}
.gjsp-props--trait label{display:block}
.gjsp-props--trait .gjsp-select{width:100%;box-sizing:border-box;padding:6px 8px;margin:4px 0 10px;background:rgba(0,0,0,.25);border:1px solid rgba(255,255,255,.2);color:inherit;border-radius:3px}
.gjsp-props--trait .gjsp-tabs{flex-wrap:wrap}
.gjs-trt-trait:has(.gjsp-trait){display:block;padding:0 10px}
.gjs-field:has(>.gjsp-trait){background:none;padding:0;border:0;box-shadow:none}
.gjsp-trait input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]):not([type=file]),.gjsp-trait select,.gjsp-trait textarea{width:100%;border:1px solid rgba(255,255,255,.2);background:rgba(0,0,0,.2);color:inherit;padding:5px 8px;border-radius:3px;box-sizing:border-box;font:inherit}
.gjsp-trait input[type=checkbox],.gjsp-trait input[type=radio]{appearance:auto;-webkit-appearance:auto;display:inline-block;width:auto;height:auto;margin:0 6px 0 0;vertical-align:middle}
.gjsp-trait select option{color:#222}
.gjsp-board{position:absolute;inset:0;z-index:200;display:flex;flex-direction:column;background:#1e1e1e;color:#ddd;font:12px/1.4 var(--gjs-main-font,Helvetica,sans-serif)}
.gjsp-board__bar{display:flex;align-items:center;gap:6px;height:40px;padding:0 10px;background:var(--gjs-primary-color,#2c2c2c);border-bottom:1px solid rgba(0,0,0,.4);flex:none}
.gjsp-board__title{font-weight:600;margin-inline-end:8px}
.gjsp-board__chips{display:flex;gap:4px;flex-wrap:wrap}
.gjsp-board__chip{border:1px solid rgba(255,255,255,.18);background:none;color:inherit;border-radius:12px;padding:2px 10px;cursor:pointer;opacity:.55;font:inherit}
.gjsp-board__chip.is-on{opacity:1;background:rgba(255,255,255,.1)}
.gjsp-board__sp{flex:1}
.gjsp-board__btn{background:none;border:0;color:inherit;cursor:pointer;min-width:28px;height:28px;border-radius:4px;font:inherit;font-size:14px}
.gjsp-board__btn:hover{background:rgba(255,255,255,.1)}
.gjsp-board__btn[data-role="zoom-100"]{font-size:12px;min-width:52px}
.gjsp-board__vp{position:relative;flex:1;overflow:hidden;cursor:default;outline:none;background-color:#1e1e1e;background-image:radial-gradient(rgba(255,255,255,.07) 1px,transparent 1px);background-size:24px 24px;touch-action:none}
.gjsp-board__vp.is-space,.gjsp-board__vp.is-panning{cursor:grabbing}
.gjsp-board__vp.is-space:not(.is-panning){cursor:grab}
.gjsp-board__world{position:absolute;left:0;top:0;transform-origin:0 0;will-change:transform}
.gjsp-board__sec{position:absolute;white-space:nowrap;font-size:calc(22px * var(--gjsp-inv,1));font-weight:600;color:#aaa;transform:translateY(-110%)}
.gjsp-board__frame{position:absolute;background:#fff;box-shadow:0 0 0 calc(1px * var(--gjsp-inv,1)) rgba(255,255,255,.12)}
.gjsp-board__frame.is-current{box-shadow:0 0 0 calc(2px * var(--gjsp-inv,1)) rgba(120,180,255,.6)}
.gjsp-board__frame.is-selected{box-shadow:0 0 0 calc(2px * var(--gjsp-inv,1)) var(--gjs-quaternary-color,#d278c9)}
.gjsp-board__label{position:absolute;left:0;bottom:100%;max-width:100%;padding-bottom:calc(4px * var(--gjsp-inv,1));font-size:calc(12px * var(--gjsp-inv,1));color:#bbb;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:move;user-select:none}
.gjsp-board__label{display:flex;align-items:flex-end;gap:calc(8px * var(--gjsp-inv,1));width:100%;max-width:none;box-sizing:border-box}
.gjsp-board__name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}
.gjsp-board__tools{display:flex;gap:calc(2px * var(--gjsp-inv,1));flex:none;opacity:.55;cursor:default}
.gjsp-board__frame:hover .gjsp-board__tools,.gjsp-board__frame.is-selected .gjsp-board__tools,.gjsp-board__frame.is-live .gjsp-board__tools{opacity:1}
.gjsp-board__tool{background:rgba(255,255,255,.06);border:0;color:#ccc;cursor:pointer;border-radius:calc(3px * var(--gjsp-inv,1));font:inherit;font-size:calc(11px * var(--gjsp-inv,1));line-height:1;padding:calc(3px * var(--gjsp-inv,1)) calc(6px * var(--gjsp-inv,1))}
.gjsp-board__tool:hover{background:rgba(255,255,255,.16)}
.gjsp-board__tool.is-on{background:var(--gjs-quaternary-color,#d278c9);color:#fff}
.gjsp-board__frame.is-selected .gjsp-board__label{color:var(--gjs-quaternary-color,#d278c9)}
.gjsp-board__body{position:absolute;inset:0;overflow:hidden;display:flex;align-items:center;justify-content:center}
.gjsp-board__wait{color:#999;font-size:calc(14px * var(--gjsp-inv,1));padding:8px;text-align:center}
.gjsp-board__frame.is-loading .gjsp-board__wait::after{content:" …"}
.gjsp-board__iframe{position:absolute;left:0;top:0;height:100%;border:0;pointer-events:none;background:#fff}
.gjsp-board__veil{position:absolute;inset:0;z-index:6;display:flex;align-items:center;justify-content:center;background:rgba(20,20,20,.55);backdrop-filter:blur(2px);pointer-events:auto}
.gjsp-board__veil[hidden]{display:none}
.gjsp-board__veil{top:40px}
.gjsp-board__veil-box{min-width:240px;padding:14px 18px;border-radius:8px;background:rgba(0,0,0,.6);color:#eee;font-size:12px;text-align:center}
.gjsp-board__veil-track{margin-top:8px;height:4px;border-radius:2px;background:rgba(255,255,255,.15);overflow:hidden}
.gjsp-board__veil-bar{height:100%;width:0;background:var(--gjs-quaternary-color,#d278c9);transition:width .2s}
.gjsp-board__veil-bar.is-indeterminate{width:35%!important;animation:gjsp-veil 1s ease-in-out infinite alternate}
@keyframes gjsp-veil{from{margin-left:0}to{margin-left:65%}}
.gjsp-board__hint{position:absolute;left:50%;bottom:10px;transform:translateX(-50%);background:rgba(0,0,0,.6);padding:4px 10px;border-radius:12px;font-size:11px;opacity:.8;pointer-events:none;white-space:nowrap}
.gjsp-board--live{position:absolute;inset:0;display:block;background:none;z-index:auto;pointer-events:none}
.gjsp-board--live .gjsp-board__bar{position:absolute;left:0;right:0;top:0;z-index:5;pointer-events:auto}
.gjsp-board--live .gjsp-board__vp{position:absolute;inset:0;pointer-events:auto}
.gjsp-board--live .gjsp-board__hint{z-index:5}
.gjsp-board-live .gjs-cv-canvas__frames{transform-origin:0 0!important;pointer-events:none!important;width:100%!important;height:100%!important}
.gjsp-board-live .gjs-frame-wrapper{pointer-events:auto;left:0!important;right:auto!important;top:0!important;margin:0!important;box-shadow:0 0 0 2px var(--gjs-quaternary-color,#d278c9)}
.gjsp-board-live.gjsp-board-busy .gjs-cv-canvas__frames,.gjsp-board-live.gjsp-board-nolive .gjs-cv-canvas__frames{visibility:hidden}
.gjsp-board-live.gjsp-board-busy .gjs-tools,.gjsp-board-live.gjsp-board-nolive .gjs-tools{visibility:hidden}
.gjsp-board__frame.is-live .gjsp-board__body{visibility:hidden}
.gjsp-board__frame.is-live{background:none;box-shadow:none}
.gjsp-board__frame.is-live .gjsp-board__label{color:var(--gjs-quaternary-color,#d278c9)}
`;

export function injectCss(doc: Document = document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const s = doc.createElement('style');
  s.id = STYLE_ID;
  s.textContent = CSS + mediaCss('gjsp');
  doc.head.appendChild(s);
}
