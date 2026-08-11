The design of the ships is the most important aspect of the game, and how it should be built is very important.

# Components
The ship is made up of many different [[components.ts|components]]. These can be of a few different varieties and each of them has different functions. Certain components (functional blocks) have different levels of themselves. The level changes the stats of the component such as how energy efficient it is, how powerful it is, how fast it fires, etc, as well as a slightly different visual look.
- **Hull** - Stuff that makes up the body of the ship, blocks of different shapes, colors, and emission levels, can also be used as cosmetics on the cosmetic layer
- **Thruster** - Things that can move the ship through space
- **Batteries** - Store power created by generators and extend their reach.
- **Storage** - Store fuel and resources
- **Generators** - Generates energy from fuel and supplies ship functional blocks
- **Projectors** - Project effects at a distance, locking beams, force fields, etc.

# Rendering
The ship is made up of a [[render/grid/grid.ts|grid]]. The grid is a "layer" of the ship. The layers are as follows (from bottom to top in render order):
- **Hull** - The body of the ship where things can be placed atop
- **Coverable** (actual name tbd) - Things that don't matter if they are covered by blocks. Thrusters, generators, etc.
- **Cosmetics** - A part of the ship where you can place any "hull" type blocks (but only on top of existing hull blocks). Placing things on this layer is free and the weight of anything placed here is 0, purely for show, don't punish the player for wanting their ship to look good.
- **Placements** - Anything that isn't a hull or coverable. Mainly weapons.

# Physics
The physics of the ship are based on equations based on reality but in a 2D space instead of a 3D one. The locations of thrusters matter. If you don't have thrusters on the side of your ship, you won't be able to turn.
The ships also rotate about a center of mass which is determined by the mass of components on the ship and their locations relative to the rest of everything.
Individual ship components can take damage from attacks and collision, the ship can even break apart if under too much strain and damage or from hitting something too fast.

# Building
The ship has a few rules that must be followed when building:
- Thrusters can only go on 1-2 blocks in from the edge of the ship and must point towards that edge to keep it somewhat realistic
- Blocks can only be placed next to other hull blocks, no floating bits
- Weight distribution matters
- Cosmetics do not matter