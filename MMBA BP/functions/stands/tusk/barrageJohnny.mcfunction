scoreboard players set @s[tag=!onSkill] movesScript 0
playanimation @s[tag=!onSkill] animation.johnny.heavy2
execute as @s[tag=!onSkill] at @s run playsound xvoid.swing05 @a[r=20] ~~~ 0.85 1.1
execute as @s[tag=!onSkill] at @s run playsound xvoid.steelball_turn @a[r=20] ~~~ 0.75 1.25

tag @s[tag=!onSkill] remove chargeT
tag @s[tag=!onSkill] add barrageJohnny
tag @s[tag=!onSkill] add chargeM
tag @s[tag=!onSkill] add uncancelable
tag @s[tag=!onSkill] add iF
tag @s[tag=!onSkill] add onSkill
scoreboard players set @s[tag=barrageJohnny,scores={movesScript=1}] iFrames 4

effect @s[tag=barrageJohnny,scores={movesScript=1..20}] slowness 1 4 true
camerashake add @s[tag=barrageJohnny,scores={movesScript=5..19}] 0.08 0.1

execute as @s[tag=barrageJohnny,scores={movesScript=2}] at @s run playsound johnny.atkGL_02 @a[r=20] ~~~ 0.95 1.0

execute as @s[tag=barrageJohnny,scores={movesScript=5}] at @s run playsound xvoid.swing06 @a[r=20] ~~~ 0.9 1.0
execute as @s[tag=barrageJohnny,scores={movesScript=5}] at @s run playsound xvoid.steelball_turn2 @a[r=20] ~~~ 0.75 0.95
execute as @s[tag=barrageJohnny,scores={movesScript=5}] at @s run playsound xvoid.hit_slash_S @a[r=20] ~~~ 0.65 1.0

execute as @s[tag=barrageJohnny,scores={movesScript=8}] at @s run playsound xvoid.swing06 @a[r=20] ~~~ 0.9 1.1
execute as @s[tag=barrageJohnny,scores={movesScript=8}] at @s run playsound xvoid.steelball_turn2 @a[r=20] ~~~ 0.75 1.05
execute as @s[tag=barrageJohnny,scores={movesScript=8}] at @s run playsound xvoid.hit_slash_S @a[r=20] ~~~ 0.65 1.1

execute as @s[tag=barrageJohnny,scores={movesScript=11}] at @s run playsound xvoid.swing06 @a[r=20] ~~~ 0.9 1.2
execute as @s[tag=barrageJohnny,scores={movesScript=11}] at @s run playsound xvoid.steelball_turn2 @a[r=20] ~~~ 0.75 1.15
execute as @s[tag=barrageJohnny,scores={movesScript=11}] at @s run playsound xvoid.hit_slash_S @a[r=20] ~~~ 0.65 1.2

execute as @s[tag=barrageJohnny,scores={movesScript=14}] at @s run playsound xvoid.swing07 @a[r=20] ~~~ 0.9 1.25
execute as @s[tag=barrageJohnny,scores={movesScript=14}] at @s run playsound xvoid.steelball_turn2 @a[r=20] ~~~ 0.75 1.25
execute as @s[tag=barrageJohnny,scores={movesScript=14}] at @s run playsound xvoid.hit_slash_S @a[r=20] ~~~ 0.65 1.25

execute as @s[tag=barrageJohnny,scores={movesScript=17}] at @s run playsound xvoid.swing08 @a[r=20] ~~~ 0.9 1.3
execute as @s[tag=barrageJohnny,scores={movesScript=17}] at @s run playsound xvoid.steelball_turn2 @a[r=20] ~~~ 0.75 1.35
execute as @s[tag=barrageJohnny,scores={movesScript=17}] at @s run playsound xvoid.hit_slash_S @a[r=20] ~~~ 0.65 1.35

execute as @s[tag=barrageJohnny,scores={movesScript=5}] at @s run scriptevent xvoid:damage 0 4/4.5/4 1.1 hit:8 int:2 p=tusk:drill_hit ~~1~ barrage:-1.2/0.2 blockable

execute as @s[tag=barrageJohnny,scores={movesScript=18,act=0}] at @s rotated ~ 0 run particle tusk1:drill_finisher ^^^1.4
execute as @s[tag=barrageJohnny,scores={movesScript=18,act=1}] at @s rotated ~ 0 run particle tusk2:drill_finisher ^^^1.4
execute as @s[tag=barrageJohnny,scores={movesScript=18,act=2}] at @s rotated ~ 0 run particle tusk3:drill_finisher ^^^1.4
execute as @s[tag=barrageJohnny,scores={movesScript=18,act=3}] at @s rotated ~ 0 run particle tusk4:drill_finisher ^^^1.4

execute as @s[tag=barrageJohnny,scores={movesScript=20}] at @s run playsound xvoid.swing10 @a[r=20] ~~~ 1.0 1.05
execute as @s[tag=barrageJohnny,scores={movesScript=20}] at @s positioned ^^^4.5 if entity @e[r=4.4,family=!inanimate,type=!xvoid:dmg,type=!xp_orb,family=!damage,family=!atk,type=!item,type=!armor_stand,type=!thrown_trident,type=!arrow,type=!area_effect_cloud,type=!minecart,type=!chest_minecart,type=!command_block_minecart,type=!dragon_fireball,type=!egg,type=!snowball,type=!ender_crystal,type=!ender_pearl,type=!evocation_fang,type=!falling_block,type=!fireball,type=!fireworks_rocket,type=!fishing_hook,type=!leash_knot,type=!lightning_bolt,type=!lingering_potion,type=!llama_spit,family=!real] run playsound xvoid.steelball_hit_L @a[r=20] ~~~ 0.9 1.15
execute as @s[tag=barrageJohnny,scores={movesScript=20}] at @s run playsound xvoid.hit_wind @a[r=20] ~~~ 0.75 1.2
execute as @s[tag=barrageJohnny,scores={movesScript=20}] at @s positioned ^^^4.5 if entity @e[r=4.4,family=!inanimate,type=!xvoid:dmg,type=!xp_orb,family=!damage,family=!atk,type=!item,type=!armor_stand,type=!thrown_trident,type=!arrow,type=!area_effect_cloud,type=!minecart,type=!chest_minecart,type=!command_block_minecart,type=!dragon_fireball,type=!egg,type=!snowball,type=!ender_crystal,type=!ender_pearl,type=!evocation_fang,type=!falling_block,type=!fireball,type=!fireworks_rocket,type=!fishing_hook,type=!leash_knot,type=!lightning_bolt,type=!lingering_potion,type=!llama_spit,family=!real] run playsound xvoid.oramuda_button3 @a[r=20] ~~~ 0.85 1.0
execute as @s[tag=barrageJohnny,scores={movesScript=20,act=0}] at @s run scriptevent xvoid:damage 0 5.5/4.5/4 8.5 p=tusk1:drill_finisher ~~1~ heavy:10/2 blockable
execute as @s[tag=barrageJohnny,scores={movesScript=20,act=1}] at @s run scriptevent xvoid:damage 0 5.5/4.5/4 8.5 p=tusk2:drill_finisher ~~1~ heavy:10/2 blockable
execute as @s[tag=barrageJohnny,scores={movesScript=20,act=2}] at @s run scriptevent xvoid:damage 0 5.5/4.5/4 8.5 p=tusk3:drill_finisher ~~1~ heavy:10/2 blockable
execute as @s[tag=barrageJohnny,scores={movesScript=20,act=3}] at @s run scriptevent xvoid:damage 0 5.5/4.5/4 8.5 p=tusk4:drill_finisher ~~1~ heavy:10/2 blockable
execute as @s[tag=barrageJohnny,scores={movesScript=20}] at @s positioned ^^^4.5 if entity @e[r=4.4,family=!inanimate,type=!xvoid:dmg,type=!xp_orb,family=!damage,family=!atk,type=!item,type=!armor_stand,type=!thrown_trident,type=!arrow,type=!area_effect_cloud,type=!minecart,type=!chest_minecart,type=!command_block_minecart,type=!dragon_fireball,type=!egg,type=!snowball,type=!ender_crystal,type=!ender_pearl,type=!evocation_fang,type=!falling_block,type=!fireball,type=!fireworks_rocket,type=!fishing_hook,type=!leash_knot,type=!lightning_bolt,type=!lingering_potion,type=!llama_spit,family=!real] run scriptevent apply:knockback -2,0.3

execute as @s[tag=barrageJohnny,scores={movesScript=21}] at @s run function util/returnMovement
execute as @s[tag=barrageJohnny,scores={movesScript=21}] at @s run tag @s remove onSkill
execute as @s[tag=barrageJohnny,scores={movesScript=21}] at @s run tag @s remove uncancelable
execute as @s[tag=barrageJohnny,scores={movesScript=21}] at @s run tag @s remove chargeM
execute as @s[tag=barrageJohnny,scores={movesScript=21}] at @s run tag @s remove barrageJohnny
execute as @s[tag=barrageJohnny,scores={movesScript=21}] at @s run scoreboard players set @s cd 20
execute as @s[tag=barrageJohnny,scores={movesScript=21}] at @s run scoreboard players set @s movesScript 0
