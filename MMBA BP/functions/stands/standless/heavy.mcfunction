scoreboard players set @s[tag=!onSkill] movesScript 0
playanimation @s[tag=!onSkill] animation.standless.heavy
effect @s[tag=!onSkill] slowness 1 3 true

execute as @s[tag=!onSkill] at @s run scriptevent xvoid:damage stop
tag @s[tag=!onSkill] remove foundTarget
tag @s[tag=!onSkill] add chargeT
tag @s[tag=!onSkill] remove chargeM
tag @s[tag=!onSkill] add iF
tag @s[tag=!onSkill] add onSkill
scoreboard players set @s[scores={movesScript=1}] iFrames 4

camerashake add @s[scores={movesScript=7}] 2 0.2
execute as @s[scores={movesScript = 7}] at @s run playsound xvoid.swing10 @a[r=20]
execute as @s[scores={movesScript = 7}] at @s run playsound xvoid.oramuda_button3 @a[r=20]
execute as @s[scores={movesScript = 7}] at @s run scriptevent xvoid:damage 0 10 12.5 p=xvoid:blood ~~1~ heavy:12/2
execute as @s[scores={movesScript = 7}] at @s anchored eyes run particle minecraft:knockback_roar_particle ^^^3

execute as @s[scores={movesScript=11}] at @s run function util/returnMovement
execute as @s[scores={movesScript=11}] at @s run tag @s remove onSkill
execute as @s[scores={movesScript=11}] at @s run tag @s remove chargeT
execute as @s[scores={movesScript=11}] at @s run scoreboard players set @s sp1 -8
execute as @s[scores={movesScript=11}] at @s run scoreboard players set @s cd 10
execute as @s[scores={movesScript=11}] at @s run scoreboard players set @s movesScript 0
