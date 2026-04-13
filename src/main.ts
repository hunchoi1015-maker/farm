import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { GameManagerScene } from './scenes/GameManagerScene';
import { HUDScene } from './scenes/HUDScene';
import { VillageScene } from './scenes/VillageScene';
import { NorthYardScene } from './scenes/NorthYardScene';
import { SouthYardScene } from './scenes/SouthYardScene';
import { NorthHouseScene } from './scenes/NorthHouseScene';
import { SouthHouseScene } from './scenes/SouthHouseScene';
import { ShopScene } from './scenes/ShopScene';
import { LibraryScene } from './scenes/LibraryScene';
import { MountainScene } from './scenes/MountainScene';
import { CliffPathScene } from './scenes/CliffPathScene';
import { MountainPathScene } from './scenes/MountainPathScene';
// import { MuseumScene } from './scenes/MuseumScene';
import { TidalFlatScene } from './scenes/TidalFlatScene';
import { BeachScene } from './scenes/BeachScene';

const config: Phaser.Types.Core.GameConfig = {
  type:            Phaser.AUTO,
  width:           960,
  height:          540,
  backgroundColor: '#2d5a27',
  physics: {
    default: 'arcade',
    arcade:  { debug: false },
  },
  scale: {
    mode:       Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [
    BootScene,
    GameManagerScene,
    HUDScene,
    VillageScene,
    NorthYardScene,
    SouthYardScene,
    NorthHouseScene,
    SouthHouseScene,
    ShopScene,
    LibraryScene,
    MountainScene,
    CliffPathScene,
    MountainPathScene,
    TidalFlatScene,
    BeachScene,
  ],
};

new Phaser.Game(config);