scoreboard players set @s[tag=!onSkill] movesScript 0
playanimation @s[tag=!onSkill] animation.diego.high
event entity @s[tag=!onSkill] xvoid:ng
execute as @s[tag=!onSkill] rotated ~ 0 run scriptevent apply:knockback 0, 0.2

tag @s[tag=!onSkill] remove foundTarget
tag @s[tag=!onSkill] remove chargeT
tag @s[tag=!onSkill] add high
tag @s[tag=!onSkill] add iF
tag @s[tag=!onSkill] add onSkill
scoreboard players set @s[scores={movesScript=1}] iFrames 4

camerashake add @s[scores={movesScript=2}] 0.4 0.2
effect @s[scores={movesScript=1}] jump_boost 0 3 true
execute as @s[scores={movesScript = 4}] at @s run playsound xvoid.swing05 @a[r=20]
execute as @s[scores={movesScript = 4}] at @s run playsound xvoid.oramuda_button3 @a[r=20]
execute as @s[scores={movesScript = 4}] at @s run playsound sm.atkGL_02 @a[r=20]
execute as @s[scores={movesScript = 4}] at @s run scriptevent xvoid:damage 0 6.5/5/4 13.5 p=sfx:hits_basic ~~1~ heavy:10/2 unblockable
execute as @s[scores={movesScript = 4}] rotated ~ 0 run scriptevent apply:knockback 3, -2.5
execute as @s[scores={movesScript = 4}] rotated ~ 0 run scriptevent xvoid:waveshard 2
execute as @s[scores={movesScript = 6}] rotated ~ 0 positioned ^^^3 run scriptevent xvoid:blockwave 4 0.3
execute as @s[scores={movesScript = 4}] at @s anchored eyes run particle xvoid:punch_shockwave ^^^2
execute as @s[scores={movesScript = 4}] at @s anchored eyes run particle minecraft:knockback_roar_particle ^^^3

execute as @s[scores={movesScript=6}] at @s run function util/returnMovement
execute as @s[scores={movesScript=6}] at @s run tag @s remove onSkill
execute as @s[scores={movesScript=6}] at @s run tag @s remove high
execute as @s[scores={movesScript=6}] at @s run tag @s add highCD
execute as @s[scores={movesScript=6}] at @s run scoreboard players set @s sp1 -15
execute as @s[scores={movesScript=6}] at @s run scoreboard players set @s cd 15
execute as @s[scores={movesScript=6}] at @s run scoreboard players set @s movesScript 0
