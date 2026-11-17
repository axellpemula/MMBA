scoreboard players set @s[tag=!onSkill] movesScript 0
playanimation @s[tag=!onSkill] animation.johnny.heavy
execute as @s[tag=!onSkill] at @s run playsound xvoid.swing05 @a[r=20] ~~~ 0.85 1.05
execute as @s[tag=!onSkill] at @s run playsound xvoid.steelball_turn @a[r=20] ~~~ 0.7 1.2

tag @s[tag=!onSkill] remove chargeM
tag @s[tag=!onSkill] add heavyJohnny
tag @s[tag=!onSkill] add chargeT
tag @s[tag=!onSkill] add iF
tag @s[tag=!onSkill] add onSkill
scoreboard players set @s[tag=heavyJohnny,scores={movesScript=1}] iFrames 4

effect @s[tag=heavyJohnny,scores={movesScript=1..13}] slowness 1 3 true
camerashake add @s[scores={movesScript=7}] 2 0.2
execute as @s[tag=heavyJohnny,scores={movesScript=3}] at @s run playsound johnny.atkJL_01 @a[r=20] ~~~ 0.95 1.0

execute as @s[tag=heavyJohnny,scores={movesScript=9}] at @s run playsound xvoid.swing10 @a[r=20] ~~~ 1.0 1.0
execute as @s[tag=heavyJohnny,scores={movesScript=9}] at @s run playsound xvoid.steelball_hit_L @a[r=20] ~~~ 0.9 1.1
execute as @s[tag=heavyJohnny,scores={movesScript=9}] at @s run playsound xvoid.hit_std_L @a[r=20] ~~~ 0.8 1.1
execute as @s[tag=heavyJohnny,scores={movesScript=9}] at @s run playsound xvoid.oramuda_button3 @a[r=20] ~~~ 0.85 0.95
execute as @s[tag=heavyJohnny,scores={movesScript=9}] at @s run particle minecraft:knockback_roar_particle ~~1~
execute as @s[tag=heavyJohnny,scores={movesScript=9}] at @s run scriptevent xvoid:damage 0 6/5/4 16.3 p=tusk:m1_hit ~~1~ heavy:12/2

execute as @s[tag=heavyJohnny,scores={movesScript=16}] at @s run function util/returnMovement
execute as @s[tag=heavyJohnny,scores={movesScript=16}] at @s run tag @s remove onSkill
execute as @s[tag=heavyJohnny,scores={movesScript=16}] at @s run tag @s remove chargeT
execute as @s[tag=heavyJohnny,scores={movesScript=16}] at @s run tag @s remove heavyJohnny
execute as @s[tag=heavyJohnny,scores={movesScript=16}] at @s run scoreboard players set @s cd 20
execute as @s[tag=heavyJohnny,scores={movesScript=16}] at @s run scoreboard players set @s sp1 -15
execute as @s[tag=heavyJohnny,scores={movesScript=16}] at @s run scoreboard players set @s movesScript 0

