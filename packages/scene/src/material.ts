import type { Billboard } from './index.js'
import type { DeathKind } from './death.js'

const materials: readonly [DeathKind, RegExp][] = [
  ['bone', /\b(skeleton|skeletal|skull|bone dragon|lich|ancient champion|draugr)\b/],
  ['ice', /\bsimulacrum\b/],
  ['spirit', /^spectral (?!weapon\b)/],
  ['blue-slime', /\b(endoplasm|azure jelly|jellyfish|nascent plasmodium)\b/],
  ['slime', /\b(jelly|slime|rockslime|ooze|acid blob|amoeba|dissolution|slymdra)\b/],
  ['ice', /\b(ice beast|ice statue|ice elemental|block of ice|orb of winter|icy jade|hoarfrost cannon|pillar of rime|splinterfrost barricade)\b/],
  ['ice', /\bblizzard demon\b/],
  ['fire', /\b(fire elemental|fire vortex|fire bat|foxfire|efreet|orb of fire|creeping inferno|solar ember|fiery jade|blazeheart core)\b/],
  ['water', /\b(water elemental|water spirit|wellspring)\b/],
  ['stone', /\b(gargoyle|golem|statue|boulder$|earth elemental|iron elemental|quicksilver elemental|saltling|ushabti|earthen jade)\b/],
  ['stone', /\b(crystal guardian|crystal echidna|pillar of salt|pile of debris|diamond obelisk|petrified flower|obsidian bat)\b/],
  ['stone', /\b(dancing weapon|spectral weapon|clockwork bee|phalanx beetle|diamond sawblade|walking alembic|stack of scrap)\b/],
  ['stone', /\b(platinum paragon|rusted inspector|peacekeeper|mannequin|nargun|screaming refraction)\b/],
  ['insect', /\b(ant|beetle|\w*roach|spider|scorpion|crab|hornet|wasp|bee|scarab|moth|mosquito|centipede|cicada|butterfly)\b/],
  ['insect', /\b(meliai|tarantella|culicivora|demonic crawler|broodmother)\b/],
  ['spirit', /\b(ghost|spectral|phantom|wraith|wisp|^shadow$|shadowghast|shadow puppet|player shadow|lost soul|floating eye)\b/],
  ['spirit', /\b(vortex|maelstrom|air elemental|ball lightning|airy jade|twister|living spell|boundless tesseract)\b/],
  ['spirit', /\b(orb of (?:destruction|entropy)|globe of annihilation|ballistomycete spore|battlesphere|fulminant prism|lightning spire)\b/],
  ['spirit', /\b(rending blade|armour echo|shooting star|wretched star|thermic dynamo)\b/],
  ['plant', /\b(fungus|mushroom|plant|bush|tree|thorn|vine|cactus|oklob|ballistomycete|lotus|briar patch|mangrove)\b/],
  ['plant', /\b(death cob|deathcap|toadstool|sleepcap|burstshroom|caustic sporangium)\b/],
]

function namedMaterial(name: string): DeathKind | undefined {
  return materials.find(([, match]) => match.test(name))?.[0]
}

/** Body material is shared by hit and death debris. Tile identity handles renamed creatures. */
export function creatureMaterial(b: Billboard, tileName = ''): DeathKind {
  const name = b.name?.toLowerCase() ?? ''
  const tile = tileName.toLowerCase().replace(/^mons_/, '').replace(/_\d+$/, '').replaceAll('_', ' ')
  const motion = b.life?.motion
  return b.bodyMaterial ?? namedMaterial(name) ?? namedMaterial(tile)
    ?? (motion === 'ooze' ? 'slime' : motion === 'plant' ? 'plant' : motion === 'crystal' ? 'stone'
      : motion === 'flame' ? 'fire' : motion === 'swirl' ? 'spirit' : 'flesh')
}
