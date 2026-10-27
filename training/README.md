# RVC Voice Model Fine-Tuning Guide (Approach B)

This directory contains everything needed to train a personalized, real-time neural voice conversion model of your voice using **RVC v2 (Retrieval-based Voice Conversion)**.

---

## Overview

* **Input Data:** 5 to 10 minutes of clean recorded voice samples (captured via our Next.js Dataset Studio or `backend/record_dataset.py`).
* **Hardware Recommendation:** Free Google Colab **T4 GPU** (~15–20 minutes training time) vs local CPU (several hours).
* **Output Deliverables:**
  1. `<your_model_name>.pth` (neural weights)
  2. `added_<your_model_name>_v2.index` (feature retrieval index)

---

## Step-by-Step Training Instructions

### Step 1: Record Your Voice Dataset
1. Open the **VoiceForge AI** dashboard at `http://localhost:3000` and switch to the **Dataset Studio** tab (or run `python backend/record_dataset.py`).
2. Read the 40 phonetically balanced prompt sentences. Speak in your natural, comfortable conversational tone using your close-proximity microphone.
3. Click **"Process & Export Dataset (.zip)"**. This creates `backend/dataset/user_voice_dataset.zip`.

### Step 2: Open Google Colab
1. Go to [Google Colab](https://colab.research.google.com/) and upload the notebook [`RVC_Voice_Model_Training.ipynb`](file:///d:/voice-enhancer/training/RVC_Voice_Model_Training.ipynb).
2. Set Runtime to **GPU** (`Runtime -> Change runtime type -> T4 GPU`).
3. Upload your `user_voice_dataset.zip`.

### Step 3: Run Training Cells
1. **Cell 1: Environment Setup:** Clones RVC v2, installs PyTorch/CUDA libraries, and downloads pre-trained HuBERT and RMVPE foundation models.
2. **Cell 2: Feature Extraction:** Runs `RMVPE` pitch extraction and `HuBERT` semantic feature extraction on your audio slices.
3. **Cell 3: Training:** Runs for 150–200 epochs (takes ~15 minutes on Colab T4).
4. **Cell 4: Export:** Packages your `.pth` model and `.index` file and downloads them.

### Step 4: Drop Into Backend
Drop the resulting `.pth` and `.index` files into `backend/models/`:
```
backend/models/
  ├── my_voice.pth
  └── added_my_voice_v2.index
```
Restart the backend server, and your custom voice timbre profile will be loaded for real-time resynthesis!
