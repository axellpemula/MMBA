# --- Scary Monsters Full Dino Mode (act=1) M1s ---
scoreboard players add @s[scores={sp1=19,m1=0..,sneak=0},tag=!onSkill] m1 1

# --- animation (same playanimation animations)
playanimation @s[scores={sp1=19,m1=1,sneak=0},tag=!onSkill] animation.diego.sm_m1a
playanimation @s[scores={sp1=19,m1=2,sneak=0},tag=!onSkill] animation.diego.sm_m1b
playanimation @s[scores={sp1=19,m1=3,sneak=0},tag=!onSkill] animation.diego.sm_m1c
playanimation @s[scores={sp1=19,m1=4,sneak=0},tag=!onSkill] animation.diego.sm_m1d
playanimation @s[scores={sp1=19,m1=5,sneak=0},tag=!onSkill] animation.diego.sm_m1e
camerashake add @s[scores={sp1=19,sneak=0},tag=!onSkill] 0.16 0.12
camerashake add @s[scores={sp1=-104,sneak=0},tag=!onSkill] 0.35 0.2
camerashake add @s[scores={sp1=-24,m1=5,sneak=0},tag=!onSkill] 2.0 0.25

# --- damage (heavier feral reach & power)
execute as @s[scores={sp1=19,m1=1,sneak=0},tag=!onSkill] run scriptevent xvoid:damage 0 5.5/5 8.0 p=sm:hit ~~1~ barrage:2/0.5
execute as @s[scores={sp1=19,m1=2,sneak=0},tag=!onSkill] run scriptevent xvoid:damage 0 6/7/5 7.5 p=sm:hit ~~1~ barrage:2/0.5
execute as @s[scores={sp1=-104,sneak=0},tag=!onSkill] run scriptevent xvoid:damage 0 9/13/9 10.8 p=sm:hit ~~1~ heavy:-0.5/2.2
execute as @s[scores={sp1=19,m1=4,sneak=0},tag=!onSkill] run scriptevent xvoid:damage 0 5.5/9/5 8.0 p=sm:hit ~~1~ barrage:2/-0.2
execute as @s[scores={sp1=19,m1=5,sneak=0},tag=!onSkill] run scriptevent xvoid:damage 0 6.5/7/6 14.5 p=sm:hit ~~1~ heavy:13/2.2

# --- movement (feral raptor lunges)
execute as @s[scores={sp1=19,m1=1..2,sneak=0},tag=!onSkill] rotated ~ 0 run scriptevent apply:knockback 1.4, 0
execute as @s[scores={sp1=19,m1=3,sneak=0},tag=!onSkill] rotated ~ 0 run scriptevent apply:knockback 1.5, 0.32
execute as @s[scores={sp1=19,m1=4,sneak=0},tag=!onSkill] rotated ~ 0 run scriptevent apply:knockback 1.5, 0
execute as @s[scores={sp1=19,m1=5,sneak=0},tag=!onSkill] rotated ~ 0 run scriptevent apply:knockback 3.4, 0.1

# --- sound (heavy swings + impacts + dino growls ONLY, no Diego voice)
execute as @s[scores={sp1=19,m1=1,sneak=0},tag=!onSkill] run playsound xvoid.swing06 @a[r=20] ~~~ 1 0.85
execute as @s[scores={sp1=19,m1=2,sneak=0},tag=!onSkill] run playsound xvoid.swing07 @a[r=20] ~~~ 1 0.85
execute as @s[scores={sp1=19,m1=3,sneak=0},tag=!onSkill] run playsound xvoid.swing08 @a[r=20] ~~~ 1 0.8
execute as @s[scores={sp1=-104,sneak=0},tag=!onSkill] run playsound xvoid.groundHit @a[r=20] ~~~ 0.8 1.15
execute as @s[scores={sp1=19,m1=4,sneak=0},tag=!onSkill] run playsound xvoid.swing09 @a[r=20] ~~~ 1 0.85
execute as @s[scores={sp1=19,m1=5,sneak=0},tag=!onSkill] run playsound xvoid.swing10 @a[r=20] ~~~ 1 0.8
execute as @s[scores={sp1=19,m1=5,sneak=0},tag=!onSkill] run playsound xvoid.groundHit @a[r=20] ~~~ 1 1.0

# --- dino growls only
execute as @s[scores={sp1=19,m1=1,sneak=0},tag=!onSkill] run playsound sm.dino_roar_short @a[r=20]
execute as @s[scores={sp1=19,m1=2,sneak=0},tag=!onSkill] run playsound sm.dino_roar_short @a[r=20]
execute as @s[scores={sp1=-104,sneak=0},tag=!onSkill] run playsound sm.dino_roar_long @a[r=20]
execute as @s[scores={sp1=19,m1=4,sneak=0},tag=!onSkill] run playsound sm.dino_roar_short @a[r=20]
execute as @s[scores={sp1=19,m1=5,sneak=0},tag=!onSkill] run playsound sm.dino_roar_long @a[r=20]

# --- vfx
execute as @s[scores={sp1=-104,sneak=0},tag=!onSkill] run particle sfx:impact ~~~
execute as @s[scores={sp1=19,m1=5,sneak=0},tag=!onSkill] rotated ~ 0 run particle sfx:impact ^^^2

scoreboard players set @s[scores={sp1=19,sneak=0,m1=3},tag=!onSkill] sp1 -107
scoreboard players set @s[scores={sp1=-100},tag=!onSkill] sp1 10
scoreboard players set @s[scores={sp1=19,sneak=0,m1=5},tag=!onSkill] sp1 -25
scoreboard players set @s[scores={sneak=0,m1=10..15},tag=!onSkill] sp1 10
scoreboard players set @s[scores={sneak=0,m1=10..15},tag=!onSkill] m1 1
