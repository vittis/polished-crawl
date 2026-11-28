import type { CreatureSize } from '@orbrun/scene'

// Crawl's body sizes are absent from WebTiles typedata. Use names so the
// lookups work across server versions without depending on monster enum IDs.
// Source: crawl/crawl dat/mons at 0.34.1 and 7922e2f36647dcae5ab1349b9252027eeea4b4a7.
// Medium is the neutral default, including for unfamiliar monsters.
const sizeGroups = {
  tiny: `
    ballistomycete|bat|bes kemwar|bomblet|burstshroom|butterfly|caustic shrike|chonchon|clockwork bee|curse skull|
    curse toe|death cob|deathcap|dormant clockwork bee|fire bat|frilled lizard|fungus|golden eye|haunted armour|
    hornet|hypnotail|killer bee|laughing skull|living spell|murray|obsidian bat|rat|raven|redback|river rat|
    shard shrike|sleepcap|spark wasp|toadstool|vampire bat|wandering mushroom|weeping skull|will-o-the-wisp|
  `,
  little: `
    adder|agnes|airy jade|ball lightning|basilisk|battlesphere|boggart|bombardier beetle|cerulean imp|
    chaos battleshape|clockroach|crimson imp|crystal echidna|dart slug|death scarab|drude|earthen jade|enchantress|
    endoplasm|felid|fiery jade|foxfire|fulminant prism|globe of annihilation|goliath frog|grinder|hell rat|icy jade|
    natasha|orb of destruction|orb of entropy|orb of fire|orb of winter|queen bee|quokka|radroach|shadow imp|
    shadow prism|shooting star|sixfirhy|solar ember|spriggan|spriggan air mage|spriggan berserker|spriggan defender|
    spriggan druid|ushabti|vampire mosquito|white imp|wretched star|
  `,
  small: `
    acid blob|apocalypse crab|assassin centipede|azure jelly|ballistomycete spore|blazeheart core|brain worm|
    briar patch|caustic sporangium|cognitogaunt|creeping inferno|culicivora|dancing weapon|demonic plant|draugr|
    electric eel|erythrospite|fire crab|ghost crab|goblin|goji|halfling|hog|holy swine|hound|howler monkey|iguana|
    ijyb|inugami|iron imp|jackal|jelly|jumping spider|kobold|kobold blastminer|kobold demonologist|
    kobold fleshcrafter|kobold geomancer|lava snake|lightning spire|lost soul|lurking horror|marrowcuda|meliai|
    moth of wrath|nascent plasmodium|oklob plant|oklob sapling|orb spider|phalanx beetle|plant|ribbon worm|rock fish|
    saltling|scorpion|shadow demon|shadowghast|simulacrum|slime creature|sonja|soul wisp|spriggan rider|star jelly|
    steelbarb worm|strange machine|sun moth|tarantella|ufetubus|walking crystal tome|walking divine tome|
    walking earthen tome|walking frostbound tome|water moccasin|withered plant|worldbinder|wyrmhole|zombie|
  `,
  large: `
    acid dragon|air elemental|aizul|alligator|alligator snapping turtle|anaconda|apis|arachne|armataur|asmodeus|
    aspiring flesh|balrug|blazeheart golem|blizzard demon|boreas|boulder beetle|boundless tesseract|brimstone fiend|
    broodmother|bunyip|cacodemon|catoblepas|centaur|centaur warrior|chaos spawn|crawling flesh cage|crocodile|
    crystal guardian|death drake|death yak|deep troll|deep troll earth mage|deep troll shaman|demonic crawler|
    diamond obelisk|diamond sawblade|dispater|earth elemental|electric golem|elemental wellspring|ereshkigal|erolcha|
    executioner|fire elemental|fire vortex|formless jellyfish|ghost moth|gloorx vloq|goblin rider|great orb of eyes|
    green death|guardian mummy|guardian serpent|hell sentinel|hellwing|hippogriff|hoarfrost cannon|ice beast|
    ice fiend|ice statue|ignacio|iron elemental|iron golem|iron troll|ironbound thunderhulk|komodo dragon|
    large abomination|lindwurm|lodul|lom lobon|manticore|mnoleg|mongrel wurm|moon troll|morphogenic ooze|
    mountainshell|naga|naga mage|naga ritualist|naga sharpshooter|naga warrior|nagaraja|nessos|obsidian statue|ogre|
    ogre mage|oni|oni incarcerator|orange crystal statue|pandemonium lord|parghit|pargi|petrified flower|
    pile of debris|pile of flesh|platinum paragon|polar bear|quicksilver elemental|rime drake|roaming sludgefish|
    roxanne|royal jelly|seismosaurus|sewage sovereign|sin beast|sky beast|skyshark|small abomination|snaplasher vine|
    snaplasher vine segment|snorg|spatial vortex|sphinx marauder|splinterfrost barricade|starspawn tentacle|
    starspawn tentacle segment|statue|steam dragon|swamp drake|tentacle|tentacle segment|thorn hunter|
    thrashing horror|tiamat|toenail golem|torpor snail|training dummy|troll|twister|two-headed ogre|tyrant leech|
    tzitzimitl|vashnia|very ugly thing|walking alembic|warg|water elemental|wind drake|wyvern|yak|yaktaur|
    yaktaur captain|zykzyl|
  `,
  giant: `
    alderking|antaeus|bone dragon|boulder|bush|cactus giant|cerebov|chuck|colossal amoeba|cyclops|dire elephant|
    eldritch tentacle|eldritch tentacle segment|elephant|elephant slug|emperor scorpion|ettin|fenstrider witch|
    fire dragon|fire giant|frost giant|gastronok|geryon|god wrath avatar|golden dragon|guardian sphinx|hellephant|
    hellfire mortar|hydra|ice dragon|iron dragon|iron giant|juggernaut|kraken|lernaean hydra|mlioglotl|
    nameless horror|nellie|orb guardian|pearl dragon|polyphemus|protean progenitor|quicksilver dragon|rockslime|
    scrapshell chimera|serpent of hell|shadow dragon|shambling mangrove|slymdra|spatial maelstrom|sphinx|
    stack of scrap|starcursed mass|stone giant|storm dragon|swamp dragon|tainted leviathan|tentacled monstrosity|
    tentacled starspawn|titan|undertaker|xtahua|
  `,
} satisfies Partial<Record<CreatureSize, string>>

const sizes = new Map<string, CreatureSize>()
for (const [size, names] of Object.entries(sizeGroups)) {
  for (const name of names.split('|').map(name => name.trim()).filter(Boolean)) sizes.set(name, size as CreatureSize)
}

// Merged slime creatures have their own body sizes in Crawl's mon-util.cc.
sizes.set('large slime creature', 'medium')
sizes.set('very large slime creature', 'large')
sizes.set('enormous slime creature', 'giant')
sizes.set('titanic slime creature', 'giant')

export function creatureSize(name: string | undefined, tileName: string): CreatureSize {
  const named = name?.toLowerCase().trim() ?? ''
  const species = named.replace(/^.* the |^(?:the |an? )/, '')
    .replace(/^spectral /, '').replace(/ (?:zombie|skeleton|simulacrum)$/, '')
    .replace(/^\w+-headed (?=hydra|lernaean hydra|slymdra)/, '')
  const tile = tileName.toLowerCase().replace(/^mons_/, '').replace(/_\d+$/, '').replaceAll('_', ' ')
  return sizes.get(named) ?? sizes.get(species) ?? sizes.get(tile) ?? 'medium'
}
