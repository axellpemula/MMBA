# --- Tusk Act 1 primary nail (fire 0.40s = F8, interval 0.20s = I4, L=12) -- see scripts/stands/tusk/TUSK.md
# click
scoreboard players add @s[scores={sp1=19,nails=1..,sneak=0},tag=!onSkill,tag=!tusk_rotation] m1 1
scoreboard players set @s[scores={m1=3..}] m1 2
tag @s[scores={sp1=19,nails=1..,sneak=0},tag=!onSkill,tag=!tusk_rotation] add tusk_shot_queued
playanimation @s[scores={sp1=19,m1=1,nails=1..,sneak=0},tag=!onSkill,tag=!tusk_rotation] animation.tusk1.nail
playanimation @s[scores={sp1=19,m1=2,nails=1..,sneak=0},tag=!onSkill,tag=!tusk_rotation] animation.tusk1.nail2
execute as @s[scores={sp1=19,nails=1..,sneak=0},tag=!onSkill,tag=!tusk_rotation] at @s run playsound xvoid.steelball_turn2 @a[r=20] ~~~ 0.7 1.2
execute as @s[scores={sp1=19,m1=1,nails=1..,sneak=0},tag=!onSkill,tag=!tusk_rotation] at @s run playsound johnny.original_16 @a[r=20] ~~~ 0.85 1.0
execute as @s[scores={sp1=19,m1=2,nails=1..,sneak=0},tag=!onSkill,tag=!tusk_rotation] at @s run playsound johnny.atkSS_01 @a[r=20] ~~~ 0.75 1.0
scoreboard players set @s[scores={sp1=19,nails=1..,sneak=0},tag=!onSkill,tag=!tusk_rotation] sp1 -12

# fire (sp1 == -I) — only when queued by an actual click
execute as @s[scores={sp1=-4,nails=1..},tag=tusk_shot_queued] at @s run playsound xvoid.hit_slash_S @a[r=20] ~~~ 0.9 1.25
execute as @s[scores={sp1=-4,nails=1..},tag=tusk_shot_queued] at @s run playsound xvoid.oramuda_button2 @a[r=20] ~~~ 0.7 1.15
camerashake add @s[scores={sp1=-4,nails=1..},tag=tusk_shot_queued] 0.12 0.08
execute as @s[scores={sp1=-4,nails=1..},tag=tusk_shot_queued] at @s run scriptevent xvoid:tusk_shot primary 1
tag @s[scores={sp1=-4}] remove tusk_shot_queued

# open spam window before sp1 reaches 0 (0 wipes m1)
scoreboard players set @s[scores={sp1=-1,m1=1..}] sp1 8
tag @s[scores={sp1=0}] remove tusk_shot_queued
