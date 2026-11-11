/**
 * Mana as a row of small blue crystals: full ones glow, spent ones turn dark grey until a mana
 * totem, an inn or a camp brings them back. The picture is assets/ui/mana.png (ElevenLabs);
 * spent crystals are the same picture greyed out with a CSS filter.
 */
export function manaHtml(mana = 0, max = 0, { label = true } = {}) {
  if (!max) return '';
  const gems = Array.from({ length: max }, (_, i) => `<img class="mana-gem ${i < mana ? 'full' : 'spent'}" src="assets/ui/mana.png" alt="">`).join('');
  return `<span class="mana" role="img" aria-label="Mana ${mana} of ${max}" title="Mana: ${mana} of ${max}. Spells cost mana; a mana totem, an inn or a camp restores it.">${label ? '<span class="mana-label">Mana</span>' : ''}${gems}<span class="mana-count">${mana}/${max}</span></span>`;
}
