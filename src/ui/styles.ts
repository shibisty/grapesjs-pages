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
.gjsp-acts{display:none;gap:1px}
.gjsp-item:hover .gjsp-acts,.gjsp-item:focus-within .gjsp-acts{display:flex}
.gjsp-act{background:none;border:0;color:inherit;cursor:pointer;padding:2px 5px;border-radius:3px;font-size:13px}
.gjsp-act:hover{background:rgba(255,255,255,.15)}
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
.gjsp-toggle.gjsp-btn-inline{position:static;box-shadow:none;padding:5px;border:0;border-radius:0;background:transparent}
`;

export function injectCss(doc: Document = document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const s = doc.createElement('style');
  s.id = STYLE_ID;
  s.textContent = CSS;
  doc.head.appendChild(s);
}
