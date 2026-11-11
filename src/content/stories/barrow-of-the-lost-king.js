/**
 * The Barrow of the Lost King: a short tale for heroes of level 1-2.
 * See src/engine/story.js for the format. Coins are in copper (100 cp = 1 gp).
 */
export const barrowOfTheLostKing = {
  id: 'barrow-of-the-lost-king',
  title: 'The Barrow of the Lost King',
  blurb: 'Mists gather on the downs, and something old has woken beneath the standing stones.',
  levels: '1-2',
  length: 'One evening',
  start: 'downs',
  scenes: {
    downs: {
      text: 'Dusk on the downs. Mist pools in the hollows between the barrows, and the standing stones lean like tired old men. Far off, among the stones, small green lights drift where no lantern should be. Nearer, a single yellow lamp bobs beside a fold of sheep.',
      choices: [
        { text: 'Walk over to the yellow lamp', to: 'shepherd' },
        { text: 'Follow the green lights among the stones', to: 'lights' },
        { text: 'Make straight for the great barrow on the hilltop', to: 'mound' },
      ],
    },
    shepherd: {
      text: 'The lamp belongs to old Wenna, who has kept sheep on these downs for sixty years. "Three ewes gone this week," she says, "dragged off towards the king\'s mound. Ardhel, they called him, Ardhel the Lost. My gran said if you speak a dead king\'s name with respect, he remembers he was a man once." She presses a heel of bread into your hands.',
      choices: [
        { text: 'Thank her, and follow the green lights', to: 'lights', set: ['knows-name'] },
        { text: 'Thank her, and climb to the great barrow', to: 'mound', set: ['knows-name'] },
      ],
    },
    lights: {
      text: 'The green lights hang just ahead, always just ahead. The grass turns spongy underfoot and the mist thickens until you can no longer see the stones. The lights are leading you somewhere, and it is not anywhere good.',
      choices: [
        { text: 'Ignore the lights and find your own way by the lie of the land', check: { skill: 'survival', dc: 12 }, success: 'safe-path', failure: 'bog' },
        { text: 'Turn back the way you came', to: 'mound' },
      ],
    },
    'safe-path': {
      text: 'You keep the rising ground on your left and the wind on your cheek, and the lights lose interest in you. Through a gap in the mist you see the great barrow, and a fresh furrow in the turf where something heavy was dragged up to its door.',
      effects: [{ xp: 25 }],
      choices: [{ text: 'Follow the furrow', to: 'mound' }],
    },
    bog: {
      text: 'The ground gives way and you sink to the waist in cold black mud. The green lights gather overhead, almost curious, then wink out one by one.',
      choices: [
        { text: 'Haul yourself out by a tussock of reeds', check: { skill: 'athletics', dc: 10 }, success: 'mound', failure: 'bog-long' },
      ],
    },
    'bog-long': {
      text: 'It takes an hour of struggling before the bog lets you go, filthy, shivering and humbled. By the time you reach the hilltop the moon is up.',
      choices: [{ text: 'Climb to the barrow', to: 'mound' }],
    },
    mound: {
      text: 'The great barrow is a long green hill ringed with stones. At its eastern end a doorway of three great slabs stands half open, its lintel carved with worn figures: a crowned man, a ship, a field of spears. The smell from within is of earth, and of something worse.',
      choices: [
        { text: 'Study the carvings on the lintel', check: { skill: 'history', dc: 12 }, success: 'carvings', failure: 'carvings-worn' },
        { text: 'Look for another way in', check: { skill: 'perception', dc: 14 }, success: 'crack', failure: 'carvings-worn' },
        { text: 'Squeeze through the doorway', to: 'hall' },
      ],
    },
    'carvings-worn': {
      text: 'Wind and rain have had nine hundred years at the stone, and whatever it once said, it keeps to itself now. There is only the doorway.',
      choices: [{ text: 'Squeeze through the doorway', to: 'hall' }],
    },
    carvings: {
      text: 'You trace the figures with your fingers: a king who came over the sea, who held the ford against the hill-men, who was buried with his sword across his knees so that he might hold it still. Beneath the crowned figure, a name: ARDHEL.',
      effects: [{ xp: 25 }],
      choices: [{ text: 'Go in, the king\'s name on your lips', to: 'hall', set: ['knows-name'] }],
    },
    crack: {
      text: 'Round the northern flank, roots have split the mound open. You wriggle through into a side chamber where a pilgrim, long ago, crawled in and never left. Their satchel has survived better than they did.',
      effects: [{ item: 'potion-healing' }, { coins: 340 }, { xp: 25 }],
      choices: [{ text: 'Creep on into the main hall', to: 'hall' }],
    },
    hall: {
      text: 'A long hall of stone, roofed with slabs. Bones lie in rows along the walls, the king\'s household laid down to guard him. As your light falls on them, two of them sit up, and then stand, and turn their empty faces towards you.',
      choices: [
        { text: 'Speak King Ardhel\'s name, and ask his guards to stand aside', requires: { flag: 'knows-name' }, check: { skill: 'religion', dc: 11 }, success: 'stand-aside', failure: 'hall-fight' },
        { text: 'Draw your weapons', to: 'hall-fight' },
        { text: 'Flee back into the night', to: 'fled' },
      ],
    },
    'stand-aside': {
      text: 'At the sound of the name, the skeletons stop. Slowly, with a sound like dry sticks, they kneel, and lay their rusted swords on the floor before you.',
      effects: [{ xp: 50 }],
      choices: [{ text: 'Walk between them to the inner door', to: 'tomb' }],
    },
    'hall-fight': {
      text: 'The dead do not speak. They come.',
      battle: { foes: ['skeleton', 'skeleton'], terrain: 'cobbles', win: 'hall-won', lose: 'fallen' },
    },
    'hall-won': {
      text: 'The last skeleton falls apart and stays apart. Among the bones you find a few coins of old minting, green with age.',
      effects: [{ coins: 600 }, { xp: 50 }],
      choices: [{ text: 'Go on to the inner door', to: 'tomb' }],
    },
    tomb: {
      text: 'The king lies on a stone bier, a long sword across his knees, its blade still bright. Around the bier, the stolen ewes lie dead, and crouched over one of them, something that was once a man looks up at you with hungry eyes. Behind it, a bloated corpse shuffles to its feet.',
      choices: [
        { text: 'Fight the ghoul and its shambling servant', to: 'tomb-fight' },
        { text: 'Call on Ardhel to drive the defilers from his tomb', requires: { flag: 'knows-name' }, check: { skill: 'persuasion', dc: 13 }, success: 'king-wakes', failure: 'tomb-fight' },
      ],
    },
    'tomb-fight': {
      text: 'The ghoul leaps the bier, claws first.',
      battle: { foes: ['ghoul', 'zombie'], terrain: 'cobbles', win: 'sword', lose: 'fallen' },
    },
    'king-wakes': {
      text: 'For a moment nothing happens. Then the dead king\'s hand closes on his sword. The ghoul shrieks, and flees into the dark with its servant stumbling after. The hand opens again, and the sword slides to the floor at your feet. A gift, or a charge: keep the downs safe.',
      effects: [{ xp: 200 }, { item: 'potion-healing' }, { coins: 2500 }],
      end: 'victory',
    },
    sword: {
      text: 'The ghoul lies still at last. You lay the ewes outside for Wenna, and leave the king his sword: some things should stay where they were put. On your way out, you take the grave-goods the household left at the threshold, enough to pay for a good many hot dinners.',
      effects: [{ xp: 150 }, { coins: 1800 }],
      end: 'victory',
    },
    fled: {
      text: 'You run until the barrow is a dark hump behind you. In the morning, Wenna counts her sheep and says nothing, which is worse than anything she could have said.',
      end: 'retreat',
    },
    fallen: {
      text: 'You wake at dawn on the wet grass outside the barrow, bruised and bloodied, with no memory of how you got there. The great door is shut, and the turf in front of it is undisturbed, as if it had not opened in nine hundred years.',
      end: 'defeat',
    },
  },
};
