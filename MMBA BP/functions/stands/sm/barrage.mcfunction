scoreboard players set @s[tag=!onSkill] movesScript 0
playanimation @s[tag=!onSkill] animation.diego.barrage
effect @s[tag=!onSkill] slowness 1 3 true

execute as @s[tag=!onSkill] at @s run scriptevent xvoid:damage stop
tag @s[tag=!onSkill] remove foundTarget
tag @s[tag=!onSkill] add chargeM
tag @s[tag=!onSkill] add iF
tag @s[tag=!onSkill] add onSkill
scoreboard players set @s[scores={movesScript=1}] iFrames 4

# --- Windup (0.0s - 0.25s: ticks 0..4) ---
effect @s[scores={movesScript=1..32}] slowness 1 3 true
execute as @s[scores={movesScript=1}] at @s run playsound xvoid.skill_wind @a[r=20] ~~~ 0.85 1.35
execute as @s[scores={movesScript=1}] at @s run playsound sm.dino_roar_short @a[r=20] ~~~ 0.45 1.15

# --- Barrage Flurry (0.25s - 1.60s: ticks 5..32) ---
camerashake add @s[scores={movesScript=5..32}] 0.1 0.1
execute as @s[scores={movesScript=5}] at @s run playsound sm.ghha_04 @a[r=20] ~~~ 0.95 1.0
execute as @s[scores={movesScript=5}] at @s run scriptevent xvoid:sm_barrage start
execute as @s[scores={movesScript=5..32}] at @s run playsound xvoid.swing06 @a[r=20] ~~~ 0.85 1.15
execute as @s[scores={movesScript=5..32}] at @s run playsound xvoid.hit_slash_S @a[r=20] ~~~ 0.55 1.15
execute as @s[scores={movesScript=5..32}] run scriptevent apply:knockback 0.5
execute as @s[scores={movesScript=5}] at @s run scriptevent xvoid:damage 0 5/5/4 1.85 hit:14 int:2 p=sfx:hits_basic ~~1~ barrage:1.1/0.2
execute as @s[scores={movesScript=5..32}] at @s run scriptevent xvoid:sm_barrage slash

# --- Cleanup (1.65s: tick 33) ---
execute as @s[scores={movesScript=33}] at @s run function util/returnMovement
execute as @s[scores={movesScript=33}] at @s run tag @s remove onSkill
execute as @s[scores={movesScript=33}] at @s run tag @s remove chargeM
execute as @s[scores={movesScript=33}] at @s run scoreboard players set @s sp1 -5
execute as @s[scores={movesScript=33}] at @s run scoreboard players set @s cd 10
execute as @s[scores={movesScript=33}] at @s run scoreboard players set @s movesScript 0
