// Render dropdowns in the protected BrowserWindow, never in native OS popups.
(() => {
  let activeMenu = null;
  const notifyLayout = () => document.dispatchEvent(new Event('protected-menu-layout'));
  const clearHoverText = (root) => {
    if (!(root instanceof Element || root instanceof Document)) return;
    const nodes = [...root.querySelectorAll('[title], img[alt]')];
    if (root instanceof Element && root.matches('[title], img[alt]')) nodes.push(root);
    nodes.forEach(node => {
      node.removeAttribute('title');
      if (node.tagName === 'IMG' && node.getAttribute('alt')) node.setAttribute('alt', '');
    });
  };

  function enhanceSelect(select) {
    if (select.multiple || select.classList.contains('protected-native-select')) return;
    const wrapper = document.createElement('span');
    wrapper.className = 'protected-select';
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = `protected-select-trigger ${select.className}`;
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-label', select.getAttribute('aria-label') ||
      document.querySelector(`label[for="${select.id}"]`)?.textContent.trim() ||
      (select.id === 'codingLanguage' ? 'Programming language' : select.id));
    const menu = document.createElement('div');
    menu.className = 'protected-select-menu';
    menu.id = `${select.id}-options`;
    menu.setAttribute('role', 'listbox');
    menu.hidden = true;
    trigger.setAttribute('aria-controls', menu.id);
    select.before(wrapper);
    wrapper.append(trigger, select);
    document.body.append(menu);
    select.classList.add('protected-native-select');
    select.tabIndex = -1;

    const sync = () => {
      trigger.textContent = select.selectedOptions[0]?.textContent || '';
      trigger.disabled = select.disabled;
      wrapper.hidden = select.hidden || select.style.display === 'none';
    };
    const valueDescriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
    Object.defineProperty(select, 'value', {
      get() { return valueDescriptor.get.call(this); },
      set(value) { valueDescriptor.set.call(this, value); sync(); },
      configurable: true,
    });
    const close = (restoreFocus = false) => {
      menu.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      if (activeMenu?.menu === menu) activeMenu = null;
      notifyLayout();
      if (restoreFocus) trigger.focus();
    };
    const position = () => {
      if (menu.hidden) return;
      const rect = trigger.getBoundingClientRect();
      const toolbar = !!document.querySelector('.command-tab');
      const width = Math.max(120, rect.width);
      const height = Math.min(220, menu.scrollHeight);
      menu.style.width = `${Math.min(width, window.innerWidth - 8)}px`;
      menu.style.left = `${Math.max(4, Math.min(rect.left, window.innerWidth - width - 4))}px`;
      const below = rect.bottom + 4;
      const top = !toolbar && below + height > window.innerHeight
        ? Math.max(4, rect.top - height - 4) : below;
      menu.style.top = `${top}px`;
      menu.style.maxHeight = `${toolbar ? 220 : Math.max(30, window.innerHeight - top - 4)}px`;
    };
    const choose = (option) => {
      select.value = option.value;
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
      close(true);
    };
    const open = () => {
      if (trigger.disabled) return;
      activeMenu?.close();
      menu.replaceChildren();
      Array.from(select.options).forEach(option => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'protected-select-option';
        item.textContent = option.textContent;
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', String(option.selected));
        item.disabled = option.disabled;
        item.addEventListener('click', () => choose(option));
        menu.append(item);
      });
      menu.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      activeMenu = { menu, trigger, close };
      position();
      notifyLayout();
      (menu.querySelector('[aria-selected="true"]') || menu.firstElementChild)?.focus({ preventScroll: true });
    };
    trigger.addEventListener('click', () => menu.hidden ? open() : close(true));
    trigger.addEventListener('keydown', event => {
      if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); open(); }
    });
    menu.addEventListener('keydown', event => {
      if (event.key === 'Escape' || event.key === 'Tab') {
        if (event.key === 'Escape') event.preventDefault();
        close(event.key === 'Escape');
        return;
      }
      const items = Array.from(menu.querySelectorAll('button:not(:disabled)'));
      const index = items.indexOf(document.activeElement);
      let next;
      if (event.key === 'ArrowDown') next = (index + 1) % items.length;
      if (event.key === 'ArrowUp') next = (index - 1 + items.length) % items.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = items.length - 1;
      if (next !== undefined && items.length) { event.preventDefault(); items[next].focus(); }
      event.stopPropagation();
    });
    select.addEventListener('change', sync);
    new MutationObserver(sync).observe(select, { attributes: true, childList: true, subtree: true });
    window.addEventListener('resize', position);
    document.addEventListener('scroll', () => close(), true);
    sync();
  }

  const init = () => {
    clearHoverText(document);
    document.querySelectorAll('select').forEach(enhanceSelect);
    new MutationObserver(records => records.forEach(record => {
      clearHoverText(record.target);
      record.addedNodes.forEach(node => {
        clearHoverText(node);
        if (node instanceof Element) {
          if (node.matches('select')) enhanceSelect(node);
          node.querySelectorAll('select').forEach(enhanceSelect);
        }
      });
    })).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['title', 'alt'] });
    document.addEventListener('pointerdown', event => {
      if (activeMenu && !activeMenu.menu.contains(event.target) && !activeMenu.trigger.contains(event.target)) activeMenu.close();
    });
    window.addEventListener('blur', () => activeMenu?.close());
    document.addEventListener('close-protected-menus', () => activeMenu?.close());
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
