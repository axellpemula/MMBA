scoreboard players set @s[tag=!onSkill] movesScript 0
playanimation @s[tag=!onSkill,scores={m1=0}] animation.d4c.flag3
playanimation @s[tag=!onSkill,scores={m1=10}] animation.d4c.flag3
playanimation @s[tag=!onSkill,scores={m1=1..5}] animation.d4c.flag3

tag @s[tag=!onSkill] remove foundTarget
tag @s[tag=!onSkill] add high
tag @s[tag=!onSkill] add iF
tag @s[tag=!onSkill] add onSkill
scoreboard players set @s[scores={movesScript=1}] iFrames 4

camerashake add @s[scores={movesScript=2}] 0.4 0.2
execute as @s[scores={movesScript = 1}] rotated ~ 0 run scriptevent apply:knockback 1, 1
execute as @s[scores={movesScript = 1}] at @s run playsound vtn.styleOn_01 @a[r=20]
execute as @s[scores={movesScript = 3}] at @s anchored eyes run particle minecraft:knockback_roar_particle ^^^
execute as @s[scores={movesScript = 3}] at @s run scriptevent xvoid:damage 0 6.5/5/4 13.5 p=sfx:hits_basic ~~1~ downslam:28/0.35
execute as @s[scores={movesScript = 3}] rotated ~ 0 run scriptevent apply:knockback 1, -2.5

execute as @s[scores={movesScript=5}] at @s run function util/returnMovement
execute as @s[scores={movesScript=5}] at @s run tag @s remove onSkill
execute as @s[scores={movesScript=5}] at @s run tag @s remove high
execute as @s[scores={movesScript=5}] at @s run tag @s add highCD
execute as @s[scores={movesScript=5}] at @s run scoreboard players set @s sp1 -15
execute as @s[scores={movesScript=5}] at @s run scoreboard players set @s cd 1
execute as @s[scores={movesScript=5}] at @s run scoreboard players set @s movesScript 0
