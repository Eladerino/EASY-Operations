// list-product.js: "List an item" — the shop listing form from the
// website (/list-a-product/), in the app. For handpicked accounts only
// (roles.js listProduct, from the Suite's app-config): the website's
// list gates who sees the screen, and the Suite route checks the same
// list again on every call. A listing is created as pending and only
// goes live after the office reviews it, exactly like the web form.
// The photo goes up first through the core media endpoint, with this
// account's own upload permission.
(function () {
  'use strict';

  const U = window.EasyUtil;
  const $ = (id) => document.getElementById(id);
  let loaded = false;

  function errText(e) {
    if (e && e.status === 404) {
      return 'The site cannot take listings from the app yet. It needs EASY Suite 2.2.55 or newer.';
    }
    if (e && e.status === 403) {
      return 'This account is not on the List a Product list. Ask Brandon to add it under EASY Suite, Settings.';
    }
    return (e && e.message) || 'Something went wrong.';
  }

  function statusLabel(status) {
    if (status === 'publish') return 'Live in the shop';
    if (status === 'pending') return 'Waiting for review';
    if (status === 'draft') return 'Draft';
    return status;
  }

  function renderListings(listings) {
    const box = $('lpListings');
    box.innerHTML = '';
    if (!listings.length) {
      box.appendChild(U.el('p', 'hint', 'Nothing listed yet. Your listings and what state they are in will show here.'));
      return;
    }
    for (const item of listings) {
      const row = U.el('div', 'card');
      row.appendChild(U.el('p', 'card-title', item.name + (item.price ? ' — $' + item.price : '')));
      row.appendChild(U.el('p', 'card-meta', statusLabel(item.status)));
      box.appendChild(row);
    }
  }

  async function load() {
    $('lpError').textContent = '';
    try {
      const data = await window.EasyApi.listProduct();
      const sel = $('lpCat');
      const current = sel.value;
      sel.innerHTML = '';
      for (const cat of data.categories) {
        const opt = document.createElement('option');
        opt.value = String(cat.id);
        opt.textContent = cat.name;
        sel.appendChild(opt);
      }
      if (current) sel.value = current;
      renderListings(data.listings);
      loaded = true;
    } catch (e) {
      $('lpError').textContent = 'Could not load the form: ' + errText(e);
    }
  }

  function open() {
    $('todayMain').classList.add('hidden');
    $('rosterView').classList.add('hidden');
    $('checkinView').classList.add('hidden');
    $('activityView').classList.add('hidden');
    $('listProductView').classList.remove('hidden');
    if (window.EasyUi) window.EasyUi.openSubview(close);
    if (!loaded) load();
  }

  function close() {
    $('listProductView').classList.add('hidden');
    $('todayMain').classList.remove('hidden');
  }

  async function submit() {
    const name = $('lpName').value.trim();
    const price = $('lpPrice').value.trim();
    const stock = $('lpStock').value.trim();
    $('lpError').textContent = '';
    $('lpDone').textContent = '';
    if (!name) { $('lpError').textContent = 'Give the item a name first.'; return; }
    if (!/^\d+(\.\d{1,2})?$/.test(price)) { $('lpError').textContent = 'Price needs to look like 25 or 25.50.'; return; }
    if (!/^\d+$/.test(stock)) { $('lpError').textContent = 'How many in stock needs to be a whole number.'; return; }
    const yes = await window.EasyUi.confirm('Send this listing for review?',
      '"' + name + '" at $' + price + ', ' + stock + ' in stock. It goes to the office for review and is not in the shop until they publish it.');
    if (!yes) return;
    const btn = $('lpSubmit');
    btn.disabled = true;
    try {
      let imageId = 0;
      const file = $('lpPhoto').files && $('lpPhoto').files[0];
      if (file) {
        const media = await window.EasyApi.uploadMedia(file);
        imageId = media.id;
      }
      await window.EasyApi.createListing({
        name,
        description: $('lpDesc').value.trim(),
        price,
        stock,
        category_id: parseInt($('lpCat').value, 10) || 0,
        image_id: imageId,
      });
      $('lpName').value = '';
      $('lpDesc').value = '';
      $('lpPrice').value = '';
      $('lpStock').value = '1';
      $('lpPhoto').value = '';
      $('lpDone').textContent = 'Thanks! "' + name + '" was sent for review. It will show below as Waiting for review until the office publishes it.';
      loaded = false;
      await load();
    } catch (e) {
      $('lpError').textContent = 'The listing was not saved: ' + errText(e);
    } finally {
      btn.disabled = false;
    }
  }

  $('listItemBtn').addEventListener('click', open);
  $('lpBack').addEventListener('click', () => {
    if (window.EasyUi) window.EasyUi.closeSubview();
    else close();
  });
  $('lpSubmit').addEventListener('click', submit);

  window.EasyListProduct = { open, close };
})();
