# Check block below player (treats air and light_block_0..15 as airborne)
scoreboard objectives add onground dummy
execute positioned ~~-0.5~ run function util/check_air_like
scoreboard players set @s[tag=_air_like] onground 0
scoreboard players set @s[tag=!_air_like] onground 1
tag @s remove _air_like
