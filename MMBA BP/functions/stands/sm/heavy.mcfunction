titleraw @s[tag=!onSkill,scores={energy=..29}] actionbar {"rawtext":[{"text":"§c< Not Enough Energy >"}]}
execute as @s[tag=!onSkill,scores={energy=..29}] at @s run playsound xvoid.oramuda_button2 @s ~~~ 0.6 0.6
tag @s[tag=!onSkill,scores={energy=..29}] remove chargeT
tag @s[tag=!onSkill,scores={energy=..29}] remove heavy

scoreboard players set @s[tag=!onSkill,scores={energy=30..}] movesScript 0
playanimation @s[tag=!onSkill,scores={energy=30..}] animation.diego.heavy
effect @s[tag=!onSkill,scores={energy=30..}] slowness 1 3 true

execute as @s[tag=!onSkill,scores={energy=30..}] run xvoid:energy 30 20
execute as @s[tag=!onSkill,scores={energy=30..}] at @s run scriptevent xvoid:damage stop
tag @s[tag=!onSkill,scores={energy=30..}] remove foundTarget
tag @s[tag=!onSkill,scores={energy=30..}] add chargeT
tag @s[tag=!onSkill,scores={energy=30..}] remove chargeM
tag @s[tag=!onSkill,scores={energy=30..}] add iF
tag @s[tag=!onSkill,scores={energy=30..}] add onSkill
scoreboard players set @s[scores={movesScript=1}] iFrames 4

# --- Windup (coil back) ---
execute as @s[scores={movesScript=1}] at @s run playsound xvoid.skill_wind @a[r=20] ~~~ 0.85 1.35
execute as @s[scores={movesScript=1}] at @s run playsound sm.dino_roar_short @a[r=20] ~~~ 0.45 1.1
execute as @s[scores={movesScript=1}] at @s run scriptevent xvoid:sm_heavy windup

# --- Dash Lunge & Twin Claw Slash ---
camerashake add @s[scores={movesScript=8}] 1.5 0.2
execute as @s[scores={movesScript=8}] at @s run playsound xvoid.skill_wind2 @a[r=20] ~~~ 1.0 1.25
execute as @s[scores={movesScript=8}] at @s run playsound xvoid.swing10 @a[r=20] ~~~ 1.0 1.1
execute as @s[scores={movesScript=8}] at @s run playsound xvoid.hit_slash_L @a[r=20] ~~~ 0.95 1.05
execute as @s[scores={movesScript=8}] at @s run playsound sm.atkJL_02 @a[r=20] ~~~ 1.0 1.0
execute as @s[scores={movesScript=8}] rotated ~ 0 run scriptevent apply:knockback 12, -2.5
execute as @s[scores={movesScript=8}] at @s run scriptevent xvoid:damage 0 16/3/4 14.8 p=xvoid:blood ~~1~ heavy:10/1.8 blockable
execute as @s[scores={movesScript=8}] at @s run scriptevent xvoid:sm_heavy slash

# --- Follow-through Slash & Dash Wake ---
execute as @s[scores={movesScript=9}] at @s run playsound xvoid.std_swing05 @a[r=20] ~~~ 0.95 1.15
execute as @s[scores={movesScript=9}] at @s run playsound xvoid.hit_slash_M @a[r=20] ~~~ 0.85 1.2
execute as @s[scores={movesScript=9}] at @s run playsound xvoid.hit_wind @a[r=20] ~~~ 0.8 1.2
execute as @s[scores={movesScript=9}] at @s run playsound xvoid.oramuda_button3 @a[r=20] ~~~ 0.9 1.05
execute as @s[scores={movesScript=9}] at @s run scriptevent xvoid:sm_heavy trail

# --- Dash Brake ---
execute as @s[scores={movesScript=10}] at @s run playsound xvoid.sliding1 @a[r=20] ~~~ 0.65 1.15

# --- Cleanup ---
execute as @s[scores={movesScript=11}] at @s run function util/returnMovement
execute as @s[scores={movesScript=11}] at @s run tag @s remove onSkill
execute as @s[scores={movesScript=11}] at @s run tag @s remove chargeT
execute as @s[scores={movesScript=11}] at @s run tag @s remove heavy
execute as @s[scores={movesScript=11}] at @s run scoreboard players set @s sp1 -8
execute as @s[scores={movesScript=11}] at @s run scoreboard players set @s cd 10
execute as @s[scores={movesScript=11}] at @s run scoreboard players set @s movesScript 0
