scoreboard objectives add maxBALL dummy
scoreboard players add @s cd 0
scoreboard players add @s[scores={cd=..25}] cd 1
execute as @s[scores={cd=-99}] run scriptevent xvoid:damage
execute as @s[scores={cd=-97}] run scriptevent xvoid:damage
execute as @s[scores={cd=-94}] run scriptevent xvoid:damage
execute as @s[scores={cd=-90}] run scriptevent xvoid:damage
execute as @s[scores={cd=-85}] run scriptevent xvoid:damage
execute as @s[scores={cd=-84..-31}] at @s positioned ~~-0.15~ run function util/check_air_like
execute as @s[scores={cd=-84..-31},tag=!_air_like] at @s run tp ~~0.1~
execute as @s[scores={cd=-84..-31},tag=_air_like] at @s run tp ~~-0.1~
execute as @s[scores={cd=-84..-31},tag=_air_like] at @s positioned ~~-0.15~ run function util/check_air_like
execute as @s[scores={cd=-84..-31},tag=_air_like] at @s run tp ~~-0.1~
execute as @s[scores={cd=-84..-31},tag=_air_like] at @s positioned ~~-0.15~ run function util/check_air_like
execute as @s[scores={cd=-84..-31},tag=_air_like] at @s run tp ~~-0.1~
scoreboard players set @s[scores={cd=-30..-1}] cd 20
scoreboard players set @s sp1 29

execute as @s run scoreboard players set @s radius 20
execute as @s run scoreboard players set @s radpos 0
tag @s[scores={cd=23..}] add return

execute as @s[scores={cd=..15}] if score @s cd >= @s maxBALL run scoreboard players set @s cd 20

execute as @s[tag=!tsed,tag=!return,scores={cd=0..15}] at @s positioned ^^0.5^0.5 run function util/check_air_like
execute at @s[tag=!tsed,tag=!return,tag=_air_like,scores={cd=0..15}] positioned ^^^1 unless entity @e[r=0.9,family=!inanimate,type=!xvoid:dmg,type=!xp_orb,family=!damage,family=!atk,type=!item,type=!armor_stand,type=!thrown_trident,type=!arrow,type=!area_effect_cloud,type=!minecart,type=!chest_minecart,type=!command_block_minecart,type=!dragon_fireball,type=!egg,type=!snowball,type=!ender_crystal,type=!ender_pearl,type=!evocation_fang,type=!falling_block,type=!fireball,type=!fireworks_rocket,type=!fishing_hook,type=!leash_knot,type=!lightning_bolt,type=!lingering_potion,type=!llama_spit,family=!real] run tp ^^^0.1
execute at @s[scores={cd=1..19}] positioned ^^^1 if entity @e[r=1.75,family=!inanimate,type=!xvoid:dmg,type=!xp_orb,family=!damage,family=!atk,type=!item,type=!armor_stand,type=!thrown_trident,type=!arrow,type=!area_effect_cloud,type=!minecart,type=!chest_minecart,type=!command_block_minecart,type=!dragon_fireball,type=!egg,type=!snowball,type=!ender_crystal,type=!ender_pearl,type=!evocation_fang,type=!falling_block,type=!fireball,type=!fireworks_rocket,type=!fishing_hook,type=!leash_knot,type=!lightning_bolt,type=!lingering_potion,type=!llama_spit,family=!real] run scoreboard players set @s[scores={cd=..15}] cd -100
execute as @s[scores={cd=1..19}] at @s positioned ^^0.5^0.7 run function util/check_air_like
scoreboard players set @s[scores={cd=1..15},tag=!_air_like] cd -100
tag @s remove _air_like