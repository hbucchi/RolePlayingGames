/**
 * The first campaign: The Steward's Signet (levels 1-3), around the market town of Ashford.
 * The format is described in src/engine/campaign.js. Maps are drawn with terrain codes
 * (. stone floor, c castle floor, o cobbles, g grass, s sand/dirt path, m mud, w shallow water,
 * r deep water, p wooden floor, t table/counter/pew, T trees, R house, # wall) and markers from
 * each place's legend (@ where the party arrives, E the way out, letters for people, foes, chests).
 * Coins are in copper: 100 cp = 1 gp, 10 cp = 1 sp.
 */
const hero = (on) => ({ on, hero: true });
const exit = (on) => ({ on, exit: true });

/** A prop on a place's map: its kind, top-left square and turn (0, 90, 180, 270). */
const P = (kind, x, y, rot = 0) => ({ kind, x, y, rot });

export const ashford = {
  id: 'ashford',
  title: 'The Steward\'s Signet',
  blurb: 'Thieves crept into Thane\'s Hall and stole the seal of Ashford. Find who took it, from the inn at the crossroads to the dark beneath the hills.',
  levels: '1-3',
  map: { image: 'assets/campaign/ashford-map.jpg', w: 1280, h: 720 },
  start: 'tavern',
  roads: [['tavern', 'town'], ['town', 'palace'], ['town', 'chapel'], ['town', 'forest'], ['tavern', 'forest'], ['forest', 'mine'], ['tavern', 'downs'], ['chapel', 'forest']],
  quest: {
    title: 'The Steward\'s Signet',
    steps: [
      { id: 'rumour', text: 'Ask around at the Lantern & Laurel for work.', done: 'heard-rumour' },
      { id: 'steward', text: 'Speak with the Steward at Thane\'s Hall.', done: 'quest-accepted' },
      { id: 'trail', text: 'Find Tamsin the hunter in the Greywood and pick up the thieves\' trail.', done: 'found-tracks' },
      { id: 'signet', text: 'Recover the signet from the Old Delving.', done: 'found-signet' },
      { id: 'return', text: 'Return the signet to the Steward at Thane\'s Hall.', done: 'quest-complete' },
    ],
  },
  locations: {
    // ---- The inn at the crossroads (where the campaign begins) ----------------------------
    tavern: {
      name: 'The Lantern & Laurel', kind: 'tavern', x: 45, y: 71, discovered: true, reveal: true, music: 'menu',
      vignette: 'assets/campaign/vignette-tavern.jpg',
      blurb: 'A roadside inn at the crossroads south of Ashford: low beams, a roaring hearth, and every rumour in the valley.',
      rows: [
        '####################',
        '#ppppMppp##pppppppp#',
        '#ttttttpp#ppptttpOp#',
        '#ppppppppppppttpppp#',
        '#pppppppppppppppppp#',
        '#ptppptppppppppptpp#',
        '#pttpptttppppBpttpp#',
        '#pppppppppppppppppp#',
        '#pppppppppppppppppp#',
        '#pppppppp@ppppppppp#',
        '#ppppppppEppppppppp#',
        '####################',
      ],
      // Furniture and fittings over the floor (engine/props.js).
      props: [P('wall-torch', 3, 0, 180), P('wall-torch', 14, 0, 180), P('chair', 2, 3), P('chair', 5, 3), P('rug', 11, 7), P('barrel', 18, 9), P('barrel', 18, 10), P('crates', 1, 10), P('candelabra', 1, 3)],
      legend: {
        '@': hero('planks'), E: exit('planks'),
        M: { on: 'planks', facing: 4, npc: {
          id: 'maudie', name: 'Maudie Thistlewood', stat: 'commoner',
          greet: [
            { if: { flag: 'quest-complete' }, say: 'There they are, the heroes of Ashford! Your first drink is on the house. The second one, too, if you tell me the whole story.' },
            { if: { notFlag: 'heard-rumour' }, say: 'Welcome to the Lantern & Laurel, travellers! Sit, sit. You look like folk who could use some coin, and I hear the Steward is offering a purse.' },
            { say: 'Back again? The stew is hot and the ale is cold. Mostly.' },
          ],
          options: [
            { label: 'Ask about the Steward\'s trouble', if: { notFlag: 'heard-rumour' }, set: ['heard-rumour'], discover: ['palace'],
              say: 'Thieves got into Thane\'s Hall three nights back and took the Steward\'s signet ring, the very seal of Ashford. He\'s beside himself. Go and see him at the Hall, up the road north-west of town.' },
            { label: 'Rent a room for the night (5 sp): sleep, mana and all', price: 50, rest: true, say: 'Up the stairs, second door on the left. Clean sheets, I promise. Mostly.' },
          ],
          shop: ['rations', 'waybread', 'torch', 'bandage', 'pipe-and-leaf'],
        } },
        O: { on: 'planks', facing: 6, npc: {
          id: 'brand', name: 'Old Brand', stat: 'veteran',
          greet: [{ say: 'Goblins, they say? Hah. In my day they\'d not dare come down from the hills.' }],
          options: [
            { label: 'Ask about the hills', once: 'heard-mine', set: ['heard-mine'],
              say: 'There\'s an old dwarf mine past the Greywood. The Old Delving, we called it. Empty a hundred years. A perfect hole for goblins to hide in, if you ask me. Nobody does.' },
          ],
        } },
        B: { on: 'planks', facing: 4, npc: {
          id: 'pell', name: 'Pell the minstrel', stat: 'commoner',
          greet: [{ say: '♪ Oh the road is long and the ale is short... ♪ A song for a silver, friend?' }],
          options: [
            { label: 'Ask for a song (1 sp)', price: 10, once: 'heard-song', set: ['heard-song'], discover: ['downs'],
              say: '♪ Ardhel the Lost beneath the stone, sleeps with his sword and waits alone... ♪ That one\'s true, you know. His barrow is out on the downs, south-east of here. Nobody goes there twice.' },
          ],
        } },
      },
    },

    // ---- The market town -------------------------------------------------------------------
    town: {
      name: 'Ashford Market', kind: 'city', x: 32, y: 51, discovered: true, reveal: true, music: 'menu',
      vignette: 'assets/campaign/vignette-town.jpg',
      blurb: 'The walled market town on the river: timber houses, a busy square, a smith and a peddler, and a crier who knows everyone\'s business.',
      rows: [
        '########################',
        '#RRRRRoooooGooooooRRRRR#',
        '#RRRRRooooooooooooRRRRR#',
        '#RRRRRooooooooooooRRRRR#',
        '#ooooooootttooooooooooo#',
        '#oooooooooPoooooooooooo#',
        '#RRRooooooooooooooooRRR#',
        '#RRRoooooooowwooooooRRR#',
        '#RRRoooooCoowwooooooRRR#',
        '#RRRHoooooooooooooooRRR#',
        '#ggggoooooooooooooogggg#',
        '#RRRRRooooooooooooRRRRR#',
        '#RRRRRooooo@ooooooRRRRR#',
        '#RRRRRooooooEoooooRRRRR#',
        '#RRRRRooooooooooooRRRRR#',
        '########################',
      ],
      // Furniture and fittings over the floor (engine/props.js).
      props: [P('forge', 4, 7), P('anvil', 5, 9), P('water-trough', 6, 10), P('fountain', 12, 7), P('crates', 8, 5), P('barrel', 12, 5)],
      legend: {
        '@': hero('cobbles'), E: exit('cobbles'),
        C: { on: 'cobbles', facing: 4, npc: {
          id: 'wat', name: 'Wat the crier', stat: 'commoner',
          greet: [
            { if: { flag: 'quest-complete' }, say: 'Hear ye! The Steward\'s signet is found, by the bravest company in Ashford! That\'s you. Hear ye!' },
            { say: 'Hear ye, hear ye! Thieves at Thane\'s Hall! The Steward seeks the bold! A reward is offered! Hear ye!' },
          ],
          options: [
            { label: 'Ask for directions', once: 'asked-directions', discover: ['palace', 'chapel'],
              say: 'Thane\'s Hall is up the road to the north-west, can\'t miss it, it\'s the big one with the towers. The Chapel of the Dawn is on the hill to the north, if you need mending.' },
          ],
        } },
        H: { on: 'cobbles', facing: 2, npc: {
          id: 'hedda', name: 'Hedda the smith', stat: 'commoner',
          greet: [{ say: 'Steel for sale. Good steel. I don\'t haggle and I don\'t do refunds.' }],
          shop: ['longsword', 'shortsword', 'spear', 'handaxe', 'javelin', 'mace', 'shield', 'leather', 'chain-shirt', 'scale-mail'],
        } },
        P: { on: 'cobbles', facing: 4, npc: {
          id: 'osric', name: 'Osric the peddler', stat: 'commoner',
          greet: [{ say: 'Potions, ropes, torches, arrows! Everything a hero needs and several things they don\'t!' }],
          shop: ['potion-healing', 'bandage', 'healers-kit', 'antidote', 'rope', 'torch', 'lantern', 'arrows', 'bolts'],
        } },
        G: { on: 'cobbles', facing: 4, npc: {
          id: 'town-guard', name: 'Town guard', stat: 'guard',
          greet: [
            { if: { flag: 'quest-accepted', notFlag: 'quest-complete' }, say: 'Off after the Steward\'s thieves, are you? Rather you than me.' },
            { say: 'Keep the peace, stranger, and we\'ll get along fine.' },
          ],
        } },
      },
    },

    // ---- The lord's hall ------------------------------------------------------------------
    palace: {
      name: 'Thane\'s Hall', kind: 'palace', x: 14, y: 30, reveal: true, music: 'menu',
      vignette: 'assets/campaign/vignette-palace.jpg',
      blurb: 'The old keep of the Thanes of Ashford, where the Steward rules in their absence.',
      rows: [
        '####################',
        '#cccccccc##cccccccc#',
        '#ccccccccStcccccccc#',
        '#cc#cccccccccccc#cc#',
        '#cccccccccccccccccc#',
        '#cc#cccccccccccU#cc#',
        '#cccccccccccccccccc#',
        '#cc#cccccccccccc#cc#',
        '#cccccccccccccccccc#',
        '#cc#Kccccccccccc#cc#',
        '#cccccccccccccccccc#',
        '#ccccccccc@cccccccc#',
        '#ccccccccEccccccccc#',
        '####################',
      ],
      // Furniture and fittings over the floor (engine/props.js).
      props: [P('rug', 8, 4), P('statue', 1, 1), P('statue', 18, 1), P('brazier', 6, 2), P('brazier', 13, 2), P('wall-torch', 4, 0, 180), P('wall-torch', 15, 0, 180), P('weapon-rack', 17, 8, 90), P('armour-stand', 18, 11)],
      legend: {
        '@': hero('castle'), E: exit('castle'),
        S: { on: 'castle', facing: 4, npc: {
          id: 'steward', name: 'Steward Aldric', stat: 'noble',
          greet: [
            { if: { flag: 'quest-complete' }, say: 'Ashford is in your debt. Thane\'s Hall is always open to you.' },
            { if: { flag: 'found-signet' }, say: 'Is that... do you have it?' },
            { if: { flag: 'quest-accepted' }, say: 'Any news of my signet? Tamsin camps in the Greywood, east of town.' },
            { say: 'You come from the Lantern? Good. I need people who can fight and keep their mouths shut.' },
          ],
          options: [
            { label: 'Offer your help', if: { notFlag: 'quest-accepted' }, set: ['quest-accepted', 'heard-rumour'], discover: ['forest'],
              say: 'Three nights ago, small thieves crept into this hall and took my signet. Without it no decree of Ashford is law. Tamsin the hunter saw tracks going into the Greywood. Find her, follow the trail, bring my ring back. Fifty gold crowns are yours.' },
            { label: 'Hand over the signet', if: { flag: 'found-signet', notFlag: 'quest-complete' }, needItem: 'stewards-signet', takeItem: true,
              set: ['quest-complete'], discover: ['downs'], give: { xp: 300, coins: 5000 },
              missing: 'You found it? Then where is it? Bring me the ring itself.',
              say: 'My signet! Goblins, under the hills... and a hobgoblin leading them. You have done Ashford a great service. Take this purse. And listen: something older stirs on the downs to the south-east. Perhaps that is a tale for heroes like you.' },
          ],
        } },
        K: { on: 'castle', facing: 2, npc: {
          id: 'brenna', name: 'Captain Brenna', stat: 'knight',
          greet: [{ say: 'The Steward trusts you. I\'m not sure I do. Yet.' }],
          options: [
            { label: 'Ask about the thieves', once: 'asked-captain',
              say: 'Small, quick, and they stank of goblin. Out through the kitchens and over the wall. But goblins don\'t plan like that. Someone was leading them.' },
          ],
        } },
        U: { on: 'castle', facing: 4, npc: { id: 'hall-guard', name: 'Hall guard', stat: 'guard', greet: [{ say: 'Mind your manners in the Steward\'s hall.' }] } },
      },
    },

    // ---- The chapel on the hill -----------------------------------------------------------
    chapel: {
      name: 'Chapel of the Dawn', kind: 'church', x: 43, y: 26, reveal: true, music: 'menu',
      vignette: 'assets/campaign/vignette-chapel.jpg',
      blurb: 'A small stone chapel on the hill north of Ashford. Mother Elswyth mends the hurt and remembers the old tales.',
      rows: [
        '################',
        '#......##......#',
        '#.....tLt......#',
        '#..............#',
        '#.ttt..A..ttt..#',
        '#..............#',
        '#.ttt.....ttt..#',
        '#..............#',
        '#.ttt.....ttt..#',
        '#..............#',
        '#.ttt.....ttt..#',
        '#......@.......#',
        '#......E.......#',
        '################',
      ],
      // Furniture and fittings over the floor (engine/props.js).
      props: [P('candelabra', 5, 2), P('candelabra', 9, 2), P('statue', 1, 1), P('statue', 14, 1), P('wall-torch', 3, 0, 180), P('wall-torch', 12, 0, 180)],
      legend: {
        '@': hero('floor'), E: exit('floor'),
        L: { on: 'floor', facing: 4, npc: {
          id: 'elswyth', name: 'Mother Elswyth', stat: 'priest',
          greet: [{ say: 'Peace be with you, child of the road. Are you hurt?' }],
          options: [
            { label: 'Ask for healing', once: 'healed-free', heal: true, say: 'Be whole. The first mending is a gift; the Dawn asks nothing of strangers.' },
            { label: 'Ask for healing (2 gp donation)', if: { flag: 'healed-free' }, price: 200, heal: true, say: 'Be whole again. Your gift keeps the candles lit.' },
            { label: 'Ask about the old tales', once: 'heard-barrow', discover: ['downs'],
              say: 'There is a barrow on the downs to the south-east where King Ardhel was laid with his sword. Lights have been seen among the stones. If you go, speak his name with respect. The dead remember courtesy.' },
          ],
        } },
        A: { on: 'floor', facing: 4, npc: {
          id: 'finn', name: 'Brother Finn', stat: 'acolyte',
          greet: [{ say: 'Bandages and herbs, for those who walk into danger. Which is everyone, these days.' }],
          shop: ['bandage', 'kingsfoil', 'potion-healing', 'antidote'],
        } },
      },
    },

    // ---- The forest -----------------------------------------------------------------------
    forest: {
      name: 'The Greywood', kind: 'forest', x: 62, y: 42, reveal: false, music: 'dungeon',
      vignette: 'assets/campaign/vignette-forest.jpg',
      blurb: 'An old, dark forest east of Ashford. The wolves have been bold this season.',
      rows: [
        '##########################',
        '#TTTTTTTTTTTggTTTTTTTTTTT#',
        '#TTTTgggTTTTggTTTgggTTTTT#',
        '#TTTgggggTTggggTgggWggTTT#',
        '#TTggggggggggggggggggggTT#',
        '#TggTTggsssssssggggTTggTT#',
        '#ggTTTgssTTTTssggWgTTTgTT#',
        '#EsssssssTTTTssssssggggTT#',
        '#@sggTTggggTTggssggTTTggT#',
        '#ggggTTgwwwwwwwwggggTTggg#',
        '#gggTTgwwwwwwwwwgggggggCT#',
        '#ggTTTggggggggsssggWggTTT#',
        '#gTTTTgggHggggsTTTggggTTT#',
        '#ggTTggggggTTTsTTTTgggTTT#',
        '#TTTTgggTTTTTTsssssggTTTT#',
        '#TTTTTTTTTTTTTTTTsTTTTTTT#',
        '#TTTTTTTTTTTTTTTTTTTTTTTT#',
        '##########################',
      ],
      // Tamsin's camp, and an old statue lost among the trees.
      props: [P('barrel', 7, 12), P('crates', 8, 13), P('statue', 12, 4)],
      // Tamsin's camp: sleep by the fire to recover hit points and mana (once per visit).
      camp: { x: 11, y: 11 },
      legend: {
        '@': hero('grass'), E: exit('sand'),
        W: { on: 'grass', foe: 'wolf' },
        C: { on: 'grass', chest: { id: 'hollow-oak', coins: 350, items: ['potion-healing', 'arrows'],
          event: { say: 'Under the roots of a hollow oak: a hunter\'s cache, wrapped in oilcloth.' } } },
        H: { on: 'grass', facing: 2, npc: {
          id: 'tamsin', name: 'Tamsin the hunter', stat: 'scout',
          greet: [
            { if: { flag: 'found-tracks' }, say: 'The trail runs north-east to the Old Delving. Good hunting.' },
            { say: 'Easy! Lower that blade. Mind the wolves, and keep to the path.' },
          ],
          options: [
            { label: 'Ask about the thieves\' trail', if: { flag: 'quest-accepted', notFlag: 'found-tracks' }, set: ['found-tracks'], discover: ['mine'],
              say: 'You\'re the Steward\'s hire? Good. Small booted feet, five or six of them, and one big pair. They went north-east, to the Old Delving. That old dwarf mine is a goblin hole now, mark my words.' },
            { label: 'Ask about the woods', if: { notFlag: 'quest-accepted' }, once: 'asked-woods',
              say: 'Wolves have been bold this season, and something has been stealing from the farms. Keep to the path.' },
          ],
        } },
      },
      onCleared: { say: 'The last wolf falls. The Greywood is quiet again.', set: ['wolves-slain'] },
    },

    // ---- The dungeon: an old dwarf mine ---------------------------------------------------
    mine: {
      name: 'The Old Delving', kind: 'dungeon', x: 85, y: 21, reveal: false, music: 'dungeon',
      vignette: 'assets/campaign/vignette-mine.jpg',
      blurb: 'An abandoned dwarf mine in the hills beyond the Greywood. Something has moved in.',
      rows: [
        '########################',
        '##########.....#########',
        '#########...C...########',
        '#######.....B....#######',
        '######..........G..#####',
        '#####.......##.......###',
        '####......####.......###',
        '###....mm#####...G...###',
        '###....mm#####......####',
        '##..........##.....#####',
        '##...G......##....######',
        '##.....................#',
        '###.....###....#########',
        '####.@..################',
        '####E...################',
        '########################',
      ],
      // Furniture and fittings over the floor (engine/props.js).
      props: [P('forge', 10, 9), P('anvil', 9, 11), P('chains', 16, 9), P('barrel', 7, 3), P('crates', 8, 3), P('rubble', 3, 9)],
      legend: {
        '@': hero('floor'), E: exit('floor'),
        G: { on: 'floor', foe: 'goblin' },
        B: { on: 'floor', foe: 'hobgoblin', facing: 4 },
        C: { on: 'floor', chest: { id: 'goblin-hoard', coins: 1200, items: ['stewards-signet', 'potion-healing'],
          event: { set: ['found-signet'], say: 'Among the goblins\' stolen trinkets lies a heavy gold ring, engraved with an oak and a river: the Steward\'s signet!' } } },
      },
      onCleared: { say: 'The Old Delving falls silent again.', set: ['cleared-delving'] },
    },

    // ---- The downs: the Barrow tale -------------------------------------------------------
    downs: {
      name: 'The Barrow Downs', kind: 'story', story: 'barrow-of-the-lost-king', x: 76, y: 75,
      vignette: 'assets/campaign/vignette-downs.jpg',
      blurb: 'Rolling downs of standing stones and old graves, south-east of the crossroads. Lights move among the barrows at night.',
    },
  },
};
