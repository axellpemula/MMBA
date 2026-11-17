# --- Scary Monsters Half Mode (act=0) Low Attack (Tail Whip) ---
scoreboard players set @s[tag=!onSkill] movesScript 0
playanimation @s[tag=!onSkill] animation.diego.low
effect @s[tag=!onSkill] slowness 1 2 true

tag @s[tag=!onSkill] remove foundTarget
tag @s[tag=!onSkill] add low
tag @s[tag=!onSkill] add iF
tag @s[tag=!onSkill] add onSkill
scoreboard players set @s[scores={movesScript=1}] iFrames 5

# --- Windup (0.05s: tick 1) ---
execute as @s[scores={movesScript=1}] at @s run playsound xvoid.skill_wind @a[r=20] ~~~ 0.75 1.4
execute as @s[scores={movesScript=1}] at @s run playsound xvoid.oramuda_button @a[r=20] ~~~ 0.85 1.1
execute as @s[scores={movesScript=1}] at @s run playsound sm.atkGM_01 @a[r=20] ~~~ 1.0 1.0
execute as @s[scores={movesScript=1}] at @s run scriptevent xvoid:sm_low windup

# --- Spin & Tail Whip Crack (0.15s - 0.20s: ticks 3..4) ---
execute as @s[scores={movesScript=3}] at @s run playsound xvoid.swing08 @a[r=20] ~~~ 0.9 1.25
execute as @s[scores={movesScript=3}] rotated ~ 0 run scriptevent apply:knockback 2.5, 0
execute as @s[scores={movesScript=3}] at @s run scriptevent xvoid:sm_low spin

camerashake add @s[scores={movesScript=4}] 0.45 0.2
execute as @s[scores={movesScript=4}] at @s run playsound xvoid.swing10 @a[r=20] ~~~ 0.95 1.2
execute as @s[scores={movesScript=4}] at @s run playsound xvoid.hit_slash_M @a[r=20] ~~~ 0.9 1.2
execute as @s[scores={movesScript=4}] at @s run playsound xvoid.hit_wind @a[r=20] ~~~ 0.85 1.25
execute as @s[scores={movesScript=4}] at @s run scriptevent xvoid:damage 0 6.5/2/4 6.8 p=sfx:hits_basic ~~0.6~ heavy:0.5/2.25
execute as @s[scores={movesScript=4}] at @s run scriptevent xvoid:sm_low whip

# --- Cleanup (0.35s: tick 7) ---
execute as @s[scores={movesScript=7}] at @s run function util/returnMovement
execute as @s[scores={movesScript=7}] at @s run tag @s remove onSkill
execute as @s[scores={movesScript=7}] at @s run tag @s remove low
execute as @s[scores={movesScript=7}] at @s run tag @s add lowCD
execute as @s[scores={movesScript=7,m1=0}] at @s run scoreboard players set @s sp1 10
execute as @s[scores={movesScript=7,m1=..4}] at @s run scoreboard players set @s m1 10
execute as @s[scores={movesScript=7}] at @s run scoreboard players set @s cd 10
execute as @s[scores={movesScript=7}] at @s run scoreboard players set @s movesScript 0
