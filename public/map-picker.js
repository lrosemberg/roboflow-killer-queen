import { MAP_CATALOG } from '../shared/maps.js';

// Native radio groups provide arrow-key selection, a single tab stop, and
// disabled states without a second keyboard implementation to keep in sync.
export function createMapPicker(container, { name, onSelect, catalog = MAP_CATALOG }) {
  const document = container.ownerDocument;
  const cards = new Map();
  container.replaceChildren();
  for (const destination of catalog) {
    const available = destination.status === 'available';
    const card = document.createElement('label');
    card.className = 'map-card';
    card.dataset.mapId = destination.id;
    card.dataset.available = String(available);
    card.style.setProperty('--map-accent', destination.accent);
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = name;
    input.value = destination.id;
    input.disabled = !available;
    input.setAttribute(
      'aria-label',
      `${destination.name} — ${destination.subtitle}${available ? '. Classic and XXL available.' : '. Coming soon; not yet playable.'}`,
    );
    const art = document.createElement('span');
    art.className = 'map-card-art';
    const image = document.createElement('img');
    image.src = destination.preview;
    image.alt = '';
    image.width = 640;
    image.height = 360;
    image.loading = 'lazy';
    art.append(image);
    if (available) {
      const check = document.createElement('span');
      check.className = 'map-card-check';
      check.textContent = '✓';
      check.setAttribute('aria-hidden', 'true');
      art.append(check);
    } else {
      const badge = document.createElement('span');
      badge.className = 'map-card-badge';
      badge.textContent = 'Coming soon';
      badge.setAttribute('aria-hidden', 'true');
      art.append(badge);
    }
    const copy = document.createElement('span');
    copy.className = 'map-card-copy';
    const title = document.createElement('strong');
    title.textContent = destination.name;
    copy.append(title);
    card.append(input, art, copy);
    input.addEventListener('change', () => {
      if (available && input.checked && !input.disabled) onSelect(destination.id);
    });
    container.append(card);
    cards.set(destination.id, { card, input, available });
  }
  return {
    update(selectedId, { disabled = false } = {}) {
      container.dataset.readonly = String(disabled);
      for (const [id, { card, input, available }] of cards) {
        input.checked = available && id === selectedId;
        input.disabled = !available || disabled;
        card.dataset.selected = String(input.checked);
      }
    },
  };
}
