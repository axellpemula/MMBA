scoreboard players set @s[tag=!onSkill] movesScript 0
playanimation @s[tag=!onSkill,scores={m1=0}] animation.tusk_act_4.barrage
playanimation @s[tag=!onSkill,scores={m1=!0}] animation.tusk_act_4.barrage2

tag @s[tag=!onSkill] remove foundTarget
tag @s[tag=!onSkill] add chargeM
tag @s[tag=!onSkill] add iF
tag @s[tag=!onSkill] add onSkill
scoreboard players set @s[scores={movesScript=1}] iFrames 4

camerashake add @s[scores={movesScript=2..}] 0.1 0.1
effect @s[scores={movesScript = 2..42}] slowness 1 3 true
execute as @s[scores={movesScript = 1}] at @s run playsound xvoid.steelball_turn @a[r=20] ~~~ 0.65 1.15
execute as @s[scores={movesScript = 2..42}] at @s run playsound xvoid.swing06 @a[r=20] ~~~ 0.65 1.15
execute as @s[scores={movesScript = 2..42}] at @s run playsound xvoid.oramuda_button @a[r=20] ~~~ 0.65 1.1
execute as @s[scores={movesScript = 2}] at @s run playsound tusk4.barrage @a[r=20] ~~~ 1.0 1.0
execute as @s[scores={movesScript = 42}] at @s run playsound xvoid.steelball_hit_L @a[r=20] ~~~ 0.85 1.1
execute as @s[scores={movesScript = 42}] at @s run playsound xvoid.oramuda_button3 @a[r=20] ~~~ 0.85 1.0
execute as @s[scores={movesScript = 2}] at @s run scriptevent xvoid:damage 0 5/5/4 1.2 hit:22 int:2 p=minecraft:critical_hit_emitter ~~1~ heavy:-.5/0.2

execute as @s[scores={sp1=19}] at @s run scoreboard players set @s movesScript 40
execute as @s[scores={sp1=19}] at @s run tag @s add chargeT

execute as @s[scores={movesScript=43}] at @s run function util/returnMovement
execute as @s[scores={movesScript=43}] at @s run tag @s remove onSkill
execute as @s[scores={movesScript=43}] at @s run tag @s remove chargeM
execute as @s[scores={movesScript=43,m1=0}] at @s run scoreboard players set @s sp1 10
execute as @s[scores={movesScript=43,m1=..4}] at @s run scoreboard players set @s m1 1
execute as @s[scores={movesScript=43}] at @s run scoreboard players set @s cd 10
execute as @s[scores={movesScript=43}] at @s run scoreboard players set @s movesScript 0
