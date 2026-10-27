# Voice Models Directory

Place your fine-tuned RVC v2 model weights and feature indices in this directory:

```
backend/models/
  ├── my_voice.pth
  └── added_my_voice_v2.index
```

The real-time engine will automatically detect and bind to the active model for neural voice timbre reconstruction.
