// Reference shell behavior, local only. Existing links own all navigation.
(function () {
  function wire() {
    const nav = document.querySelector('.side-menu'), title = document.querySelector('.page-title-row');
    if (!nav || !title) return;
    const icon = document.createElement('span'); icon.className = 'section-icon'; icon.setAttribute('aria-hidden','true'); title.prepend(icon);
    const syncIcon = () => {
      const source = nav.querySelector('a.active .icon');
      if (source) icon.replaceChildren(source.cloneNode(true));
    };
    new MutationObserver(syncIcon).observe(nav,{attributes:true,subtree:true,attributeFilter:['class']}); syncIcon();
    document.querySelectorAll('[data-chart-style]').forEach(button=>{const active=button.dataset.chartStyle===window.WBShell.chartStyle;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});
    const search = document.createElement('button'); search.type='button';search.className='nav-search';search.setAttribute('aria-label','Поиск раздела (⌘K)');
    search.innerHTML='<svg class="icon" aria-hidden="true"><use href="#icon-search"/></svg><span>Поиск</span><kbd>⌘K</kbd>';nav.before(search);
    const finder=document.createElement('dialog'); finder.className='finder';finder.setAttribute('aria-label','Поиск по платформе');
    finder.innerHTML='<div class="finder-search"><svg class="icon" aria-hidden="true"><use href="#icon-search"/></svg><input type="search" placeholder="Найти раздел…" aria-label="Название раздела"><button type="button" aria-label="Закрыть поиск">Esc</button></div><div class="finder-results"></div>';
    document.body.append(finder);
    const input=finder.querySelector('input'), results=finder.querySelector('.finder-results');
    const links=[...nav.querySelectorAll('a[data-view]')];
    const close=()=>{finder.close();search.focus({preventScroll:true});};
    function draw() {
      results.replaceChildren();
      links.filter(link=>link.textContent.toLocaleLowerCase().includes(input.value.trim().toLocaleLowerCase())).forEach(link=>{
        const button=document.createElement('button');button.type='button';
        const svg=link.querySelector('svg');if(svg)button.append(svg.cloneNode(true));
        const label=document.createElement('span');label.textContent=link.textContent.trim();button.append(label);
        button.addEventListener('click',()=>{finder.close();link.click();});results.append(button);
      });
      if(!results.children.length){const empty=document.createElement('p');empty.textContent='Раздел не найден';results.append(empty);}
    }
    function open() {
      if(finder.open){close();return;}
      input.value='';draw();finder.showModal();input.focus();
      if(!matchMedia('(prefers-reduced-motion: reduce)').matches)finder.animate([{opacity:0,translate:'0 -14px',scale:'.97'},{opacity:1,translate:'0 0',scale:'1'}],{duration:450,easing:'cubic-bezier(.34,1.56,.64,1)'});
    }
    search.addEventListener('click',open);finder.querySelector('.finder-search button').addEventListener('click',close);
    input.addEventListener('input',draw);
    input.addEventListener('keydown',e=>{if(e.key==='ArrowDown'){e.preventDefault();results.querySelector('button')?.focus();}if(e.key==='Enter'){e.preventDefault();results.querySelector('button')?.click();}});
    results.addEventListener('keydown',e=>{
      const buttons=[...results.querySelectorAll('button')],i=buttons.indexOf(document.activeElement);
      if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();buttons[(i+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();}
    });
    finder.addEventListener('click',e=>{if(e.target===finder){const r=finder.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)close();}});
    document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();open();}});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',wire,{once:true});else wire();
})();
