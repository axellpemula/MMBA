scoreboard players set @s[tag=!onSkill] movesScript 0
playanimation @s[tag=!onSkill] animation.johnny.low

tag @s[tag=!onSkill] remove foundTarget
tag @s[tag=!onSkill] add low
tag @s[tag=!onSkill] add iF
tag @s[tag=!onSkill] add onSkill
scoreboard players set @s[scores={movesScript=1}] iFrames 6

execute as @s[scores={movesScript=1}] at @s run playsound xvoid.steelball_turn2 @a[r=20] ~~~ 0.8 1.15
execute as @s[scores={movesScript=1}] at @s run playsound xvoid.oramuda_button @a[r=20] ~~~ 0.8 1.05
execute as @s[scores={movesScript=1}] at @s run playsound johnny.atkGM_01 @a[r=20] ~~~ 0.9 1.0

camerashake add @s[scores={movesScript=5}] 0.4 0.2
execute as @s[scores={movesScript=5}] at @s run playsound xvoid.swing01 @a[r=20] ~~~ 0.9 1.1
execute as @s[scores={movesScript=5}] at @s run playsound xvoid.swing08 @a[r=20] ~~~ 0.9 1.15
execute as @s[scores={movesScript=5}] at @s run playsound xvoid.hit_wind @a[r=20] ~~~ 0.75 1.25
execute as @s[scores={movesScript=5}] at @s run playsound xvoid.steelball_hit_S @a[r=20] ~~~ 0.75 1.2
execute as @s[scores={movesScript=5}] at @s run scriptevent xvoid:damage 0 6.5/2/4 7.3 p=xvoid:dj3 ~~1~ heavy:0.5/2.25
execute as @s[scores={movesScript=5}] at @s rotated ~ 0 run particle xvoid:dj3 ^^^2.5

execute as @s[scores={movesScript=8}] at @s run function util/returnMovement
execute as @s[scores={movesScript=8}] at @s run tag @s remove onSkill
execute as @s[scores={movesScript=8}] at @s run tag @s remove low
execute as @s[scores={movesScript=8}] at @s run tag @s add lowCD
execute as @s[scores={movesScript=8,m1=0}] at @s run scoreboard players set @s sp1 10
execute as @s[scores={movesScript=8,m1=..4}] at @s run scoreboard players set @s m1 10
execute as @s[scores={movesScript=8}] at @s run scoreboard players set @s cd 10
execute as @s[scores={movesScript=8}] at @s run scoreboard players set @s movesScript 0

