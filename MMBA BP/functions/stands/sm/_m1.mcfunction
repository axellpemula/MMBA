# --- Scary Monsters Half Mode (act=0) M1s ---
scoreboard players add @s[scores={sp1=19,m1=0..,sneak=0},tag=!onSkill] m1 1
execute as @s[scores={sp1=19,sp1=5..,onground=1,sneak=1,cd=0},tag=!onSkill] run tag @s add low

# --- animation
playanimation @s[scores={sp1=19,m1=1,sneak=0},tag=!onSkill] animation.diego.sm_m1a
playanimation @s[scores={sp1=19,m1=2,sneak=0},tag=!onSkill] animation.diego.sm_m1b
playanimation @s[scores={sp1=19,m1=3,sneak=0},tag=!onSkill] animation.diego.sm_m1c
playanimation @s[scores={sp1=19,m1=4,sneak=0},tag=!onSkill] animation.diego.sm_m1d
playanimation @s[scores={sp1=19,m1=5,sneak=0},tag=!onSkill] animation.diego.sm_m1e
camerashake add @s[scores={sp1=19,sneak=0},tag=!onSkill] 0.1 0.1
camerashake add @s[scores={sp1=17,m1=3,sneak=0},tag=!onSkill] 0.2 0.2
camerashake add @s[scores={sp1=-24,m1=5,sneak=0},tag=!onSkill] 1.2 0.2

# --- damage (agile human/tail combo)
execute as @s[scores={sp1=19,m1=1,sneak=0},tag=!onSkill] run scriptevent xvoid:damage 0 4.5/4 6.5 p=sfx:hits_basic ~~1~ barrage:2/0.5
execute as @s[scores={sp1=19,m1=2,sneak=0},tag=!onSkill] run scriptevent xvoid:damage 0 5/6/4 6.0 p=sfx:hits_basic ~~1~ barrage:2/0.5
execute as @s[scores={sp1=-104,sneak=0},tag=!onSkill] run scriptevent xvoid:damage 0 7.5/10/7.5 8.5 p=sfx:hits_basic ~~1~ heavy:-0.5/2
execute as @s[scores={sp1=19,m1=4,sneak=0},tag=!onSkill] run scriptevent xvoid:damage 0 4.5/7/4 6.2 p=sfx:hits_basic ~~1~ barrage:2/-0.2
execute as @s[scores={sp1=19,m1=5,sneak=0},tag=!onSkill] run scriptevent xvoid:damage 0 5/6/5 11.5 p=sfx:hits_basic ~~1~ heavy:9/1.8

# --- movement
execute as @s[scores={sp1=19,m1=1..4,sneak=0},tag=!onSkill] rotated ~ 0 run scriptevent apply:knockback 1, 0
execute as @s[scores={sp1=19,m1=3,sneak=0},tag=!onSkill] rotated ~ 0 run scriptevent apply:knockback 0, 0.25
execute as @s[scores={sp1=19,m1=5,sneak=0},tag=!onSkill] rotated ~ 0 run scriptevent apply:knockback 2.5, 0

# --- sound
execute as @s[scores={sp1=19,m1=1,sneak=0},tag=!onSkill] run playsound xvoid.swing06 @a[r=20]
execute as @s[scores={sp1=19,m1=2,sneak=0},tag=!onSkill] run playsound xvoid.swing07 @a[r=20]
execute as @s[scores={sp1=19,m1=3,sneak=0},tag=!onSkill] run playsound xvoid.swing08 @a[r=20]
execute as @s[scores={sp1=19,m1=4,sneak=0},tag=!onSkill] run playsound xvoid.swing09 @a[r=20]
execute as @s[scores={sp1=19,m1=5,sneak=0},tag=!onSkill] run playsound xvoid.swing10 @a[r=20]

# --- vfx
execute as @s[scores={sp1=-104,sneak=0},tag=!onSkill] run particle sfx:impact ~~~
execute as @s[scores={sp1=19,m1=5,sneak=0},tag=!onSkill] rotated ~ 0 run particle sfx:impact ^^^2

# --- diego voice (Half Mode)
execute as @s[scores={sp1=19,m1=1,sneak=0},tag=!onSkill] run playsound sm.atkSS_01 @a[r=20]
execute as @s[scores={sp1=19,m1=2,sneak=0},tag=!onSkill] run playsound sm.atkSS_02 @a[r=20]
execute as @s[scores={sp1=19,m1=3,sneak=0},tag=!onSkill] run playsound sm.atkJS_01 @a[r=20]
execute as @s[scores={sp1=19,m1=4,sneak=0},tag=!onSkill] run playsound sm.atkJS_02 @a[r=20]
execute as @s[scores={sp1=19,m1=5,sneak=0},tag=!onSkill] run playsound sm.atkGM_02 @a[r=20]

scoreboard players set @s[scores={sp1=19,sneak=0,m1=3},tag=!onSkill] sp1 -107
scoreboard players set @s[scores={sp1=-100},tag=!onSkill] sp1 10
scoreboard players set @s[scores={sp1=19,sneak=0,m1=5},tag=!onSkill] sp1 -25
scoreboard players set @s[scores={sneak=0,m1=10..15},tag=!onSkill] sp1 10
scoreboard players set @s[scores={sneak=0,m1=10..15},tag=!onSkill] m1 1
