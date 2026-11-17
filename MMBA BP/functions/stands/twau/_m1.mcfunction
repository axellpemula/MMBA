# --- function
scoreboard players add @s[scores={sp1=19,m1=0..,sp1=5..,sneak=0},tag=!onSkill] m1 1
execute as @s[scores={sp1=19,sp1=5..,onground=1,sneak=1,cd=0},tag=!onSkill] run tag @s add low

# --- animation
playanimation @s[scores={sp1=19,m1=1,sneak=0},tag=!onSkill] animation.twau.m1a
playanimation @s[scores={sp1=19,m1=2,sneak=0},tag=!onSkill] animation.twau.m1b
playanimation @s[scores={sp1=19,m1=3,sneak=0},tag=!onSkill] animation.twau.m1c
playanimation @s[scores={sp1=19,m1=4,sneak=0},tag=!onSkill] animation.twau.m1d
playanimation @s[scores={sp1=19,m1=5,sneak=0},tag=!onSkill] animation.twau.m1c
camerashake add @s[scores={sp1=19,sneak=0},tag=!onSkill] 0.1 0.1
camerashake add @s[scores={sp1=17,m1=3,sneak=0},tag=!onSkill] 0.2 0.2
camerashake add @s[scores={sp1=-24,m1=5,sneak=0},tag=!onSkill] 2 0.2

# --- damage
execute as @s[scores={sp1=19,m1=1,sneak=0},tag=!onSkill] run scriptevent xvoid:damage 0 4.5/4 7.1 p=sfx:hits_basic ~~1~ barrage:2/0.5
execute as @s[scores={sp1=19,m1=2,sneak=0},tag=!onSkill] run scriptevent xvoid:damage 0 5/6/4 6.2 p=sfx:hits_basic ~~1~ barrage:2/0.5
execute as @s[scores={sp1=19,m1=3,sneak=0},tag=!onSkill] run scriptevent xvoid:damage 0 4.5/6/4 9.3 p=sfx:hits_basic ~~1~ heavy:-0.5/2
execute as @s[scores={sp1=19,m1=4,sneak=0},tag=!onSkill] run scriptevent xvoid:damage 0 4.5/8/4 6.4 p=sfx:hits_basic ~~1~ barrage:2/-0.2
execute as @s[scores={sp1=19,m1=5,sneak=0},tag=!onSkill] run scriptevent xvoid:damage 0 5/6/5 12.5 p=sfx:hits_basic ~~1~ heavy:10/2

# --- movement

execute as @s[scores={sp1=19,m1=5,sneak=0},tag=!onSkill] rotated ~ 0 run scriptevent apply:knockback 2, 0

#sound
execute as @s[scores={sp1=19,m1=1,sneak=0},tag=!onSkill] run playsound xvoid.swing06 @a[r=20]
execute as @s[scores={sp1=19,m1=2,sneak=0},tag=!onSkill] run playsound xvoid.swing07 @a[r=20]
execute as @s[scores={sp1=19,m1=3,sneak=0},tag=!onSkill] run playsound xvoid.swing08 @a[r=20]
execute as @s[scores={sp1=19,m1=4,sneak=0},tag=!onSkill] run playsound xvoid.swing09 @a[r=20]
execute as @s[scores={sp1=19,m1=5,sneak=0},tag=!onSkill] run playsound xvoid.swing10 @a[r=20]

execute as @s[scores={sp1=19,m1=1..5,sneak=0},tag=!onSkill] run playsound xvoid.oramuda_button2 @a[r=20]
#diego
execute as @s[scores={sp1=19,m1=1,sneak=0},tag=!onSkill] run playsound diego.atkSS_01 @a[r=20]
execute as @s[scores={sp1=19,m1=2,sneak=0},tag=!onSkill] run playsound diego.atkSS_02 @a[r=20]
execute as @s[scores={sp1=19,m1=3,sneak=0},tag=!onSkill] run playsound diego.atkJS_01 @a[r=20]
execute as @s[scores={sp1=19,m1=4,sneak=0},tag=!onSkill] run playsound diego.atkJS_02 @a[r=20]
execute as @s[scores={sp1=19,m1=5,sneak=0},tag=!onSkill] run playsound diego.atkGM_02 @a[r=20]

scoreboard players set @s[scores={sp1=19,sneak=0,m1=5},tag=!onSkill] sp1 -25
scoreboard players set @s[scores={sneak=0,m1=10..15},tag=!onSkill] sp1 10
scoreboard players set @s[scores={sneak=0,m1=10..15},tag=!onSkill] m1 1