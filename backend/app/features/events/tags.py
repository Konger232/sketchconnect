"""
An event's hashtag (design doc, item 49, amended November 25, 2026).

The hashtag no longer joins a sketch to an event: that is the sketch's
event_id (events/links.py). It is a label that Share adds to the
caption on Instagram and Facebook, so posts can be found there.
"""
import re

HASHTAG = re.compile(r"^[A-Za-z0-9_]{3,40}$")  # an event's own tag, without the #
