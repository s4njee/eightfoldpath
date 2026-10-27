// The village terraces scene (assets/scenes/village.json) and where its art lives. Shared by the
// effects that stage something in it, so they all look at the same place.
import village from '../../../assets/scenes/village.json';
import barrel from '../../../assets/sprites/barrel.png?url';
import boulder from '../../../assets/sprites/boulder.png?url';
import chest from '../../../assets/sprites/chest.png?url';
import crystals from '../../../assets/sprites/crystals.png?url';
import knight from '../../../assets/sprites/knight.png?url';
import lantern from '../../../assets/sprites/lantern.png?url';
import mage from '../../../assets/sprites/mage.png?url';
import slime from '../../../assets/sprites/slime.png?url';
import traveller from '../../../assets/sprites/traveller.png?url';
import tree from '../../../assets/sprites/tree.png?url';
import cobblestone from '../../../assets/tiles/cobblestone.png?url';
import dirtPath from '../../../assets/tiles/dirt-path.png?url';
import grass from '../../../assets/tiles/grass.png?url';
import sand from '../../../assets/tiles/sand.png?url';
import cliff from '../../../assets/walls/cliff.png?url';
import stoneWall from '../../../assets/walls/stone-wall.png?url';
import { parseScene, type Scene, type SceneSource } from '../../gpu/diorama/scene.ts';

export const VILLAGE_ART: Readonly<Record<string, string>> = {
  barrel,
  boulder,
  chest,
  cliff,
  cobblestone,
  crystals,
  'dirt-path': dirtPath,
  grass,
  knight,
  lantern,
  mage,
  sand,
  slime,
  'stone-wall': stoneWall,
  traveller,
  tree,
};

export function villageScene(): Scene {
  // JSON types its [x, y, z] tuples as plain arrays.
  return parseScene(village as unknown as SceneSource);
}
