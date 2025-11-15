#!/usr/bin/env python3
"""
Video Brightness Calculator using WCAG Relative Luminance with Foveated Sampling

This script calculates the perceived brightness of videos in real-time using the WCAG
Relative Luminance formula with foveated vision sampling (mimics human eye perception).

Formula: L = 0.2126 * R + 0.7152 * G + 0.0722 * B
Where R, G, B are normalized to 0-1 range.

Sampling: Uses foveated vision pattern - 70% samples in center, 30% in periphery
"""

import sys
import argparse
from pathlib import Path
import numpy as np
import cv2
import time
import math


def generate_foveated_samples(width, height, max_samples, fovea_size=0.4):
    """
    Generate foveated sample positions (high density center, lower density periphery).
    Mimics human foveated vision: dense center region + sparse periphery.
    
    Args:
        width: Image width
        height: Image height
        max_samples: Maximum number of samples
        fovea_size: Size of fovea region (0-1, where 1 = full image)
        
    Returns:
        numpy array: Array of (x, y) sample positions
    """
    samples = []
    center_x = width / 2.0
    center_y = height / 2.0
    
    # Allocate 70% of samples to center (fovea), 30% to periphery
    fovea_samples = int(max_samples * 0.7)
    periphery_samples = max_samples - fovea_samples
    
    # Fovea region (center, high density)
    fovea_radius_x = (width * fovea_size) / 2.0
    fovea_radius_y = (height * fovea_size) / 2.0
    min_radius = min(fovea_radius_x, fovea_radius_y)
    
    # Generate fovea samples (uniform distribution within circle)
    for i in range(fovea_samples):
        angle = np.random.random() * 2.0 * math.pi
        radius = math.sqrt(np.random.random()) * min_radius
        
        x = center_x + math.cos(angle) * radius
        y = center_y + math.sin(angle) * radius
        
        # Clamp to valid range
        x = max(0, min(width - 1, x))
        y = max(0, min(height - 1, y))
        
        samples.append([int(x), int(y)])
    
    # Periphery region (sparse, uniform distribution outside fovea)
    for i in range(periphery_samples):
        attempts = 0
        while attempts < 20:
            x = np.random.random() * width
            y = np.random.random() * height
            
            # Check if outside fovea
            dx = (x - center_x) / fovea_radius_x
            dy = (y - center_y) / fovea_radius_y
            dist_sq = dx * dx + dy * dy
            
            if dist_sq >= 1.0:  # Outside fovea circle
                samples.append([int(x), int(y)])
                break
            
            attempts += 1
        
        # If couldn't find point outside fovea, place it at edge
        if attempts >= 20:
            angle = np.random.random() * 2.0 * math.pi
            x = center_x + math.cos(angle) * (min_radius * 1.2)
            y = center_y + math.sin(angle) * (min_radius * 1.2)
            x = max(0, min(width - 1, x))
            y = max(0, min(height - 1, y))
            samples.append([int(x), int(y)])
    
    return np.array(samples, dtype=np.int32)


def calculate_brightness_from_frame(frame, max_samples=100, fovea_size=0.4, cached_samples=None):
    """
    Calculate the perceived brightness of a frame using WCAG Relative Luminance with foveated sampling.
    
    Args:
        frame: numpy array representing the image frame (BGR format from OpenCV)
        max_samples: Maximum number of pixels to sample
        fovea_size: Size of fovea region (0-1)
        cached_samples: Pre-calculated sample positions (for performance)
        
    Returns:
        tuple: (brightness_value, updated_cached_samples)
    """
    height, width = frame.shape[:2]
    
    # Generate or reuse cached sample positions
    if cached_samples is None or len(cached_samples) == 0:
        sample_positions = generate_foveated_samples(width, height, max_samples, fovea_size)
    else:
        sample_positions = cached_samples
    
    # Convert BGR to RGB (OpenCV uses BGR by default)
    frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    
    # Normalize RGB values to 0-1 range
    rgb_normalized = frame_rgb.astype(np.float32) / 255.0
    
    # Sample pixels at foveated positions
    total_brightness = 0.0
    sample_count = len(sample_positions)
    
    for x, y in sample_positions:
        # Ensure coordinates are within bounds
        x = max(0, min(width - 1, x))
        y = max(0, min(height - 1, y))
        
        # Get RGB values at sample position
        r = rgb_normalized[y, x, 0]
        g = rgb_normalized[y, x, 1]
        b = rgb_normalized[y, x, 2]
        
        # Apply WCAG Relative Luminance formula
        # L = 0.2126 * R + 0.7152 * G + 0.0722 * B
        pixel_brightness = 0.2126 * r + 0.7152 * g + 0.0722 * b
        
        total_brightness += pixel_brightness
    
    # Calculate average brightness
    average_brightness = total_brightness / sample_count if sample_count > 0 else 0.0
    
    return average_brightness, sample_positions


def process_video_realtime(video_path, show_video=True, show_overlay=True, percentage=False, 
                           max_samples=100, fovea_size=0.4):
    """
    Process video in real-time and calculate brightness for each frame using foveated sampling.
    
    Args:
        video_path: Path to the video file
        show_video: Whether to display the video window
        show_overlay: Whether to overlay brightness on the video
        percentage: Whether to display brightness as percentage
        max_samples: Maximum number of pixels to sample per frame
        fovea_size: Size of fovea region (0-1)
    """
    try:
        # Open video file
        cap = cv2.VideoCapture(video_path)
        
        if not cap.isOpened():
            print(f"Error: Could not open video file '{video_path}'", file=sys.stderr)
            return False
        
        # Get video properties
        fps = cap.get(cv2.CAP_PROP_FPS)
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        
        print(f"Processing video: {Path(video_path).name}")
        print(f"Resolution: {width}x{height}, FPS: {fps:.2f}, Frames: {total_frames}")
        print("Press 'q' to quit, 'p' to pause/resume")
        print("-" * 50)
        
        frame_count = 0
        paused = False
        start_time = time.time()
        frame = None
        brightness = 0.0
        cached_samples = None  # Cache sample positions for performance
        
        def add_overlay(frame, brightness, frame_count, total_frames, percentage, is_paused):
            """Add brightness overlay to frame."""
            if percentage:
                text = f"Brightness: {brightness * 100:.2f}%"
            else:
                text = f"Brightness: {brightness:.4f}"
            
            # Use larger font size for better visibility
            font_scale = 1.8
            font_thickness = 4
            
            # Add background rectangle for better visibility
            (text_width, text_height), baseline = cv2.getTextSize(
                text, cv2.FONT_HERSHEY_SIMPLEX, font_scale, font_thickness
            )
            cv2.rectangle(
                frame, 
                (15, 15), 
                (25 + text_width, 50 + text_height), 
                (0, 0, 0), 
                -1
            )
            
            # Add text overlay with larger font
            cv2.putText(
                frame, 
                text, 
                (20, 45 + text_height), 
                cv2.FONT_HERSHEY_SIMPLEX, 
                font_scale, 
                (255, 255, 255), 
                font_thickness
            )
            
            # Add frame counter (smaller font)
            frame_text = f"Frame: {frame_count}/{total_frames}"
            cv2.putText(
                frame,
                frame_text,
                (20, 80 + text_height),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.6,
                (200, 200, 200),
                2
            )
            
            # Add pause indicator
            if is_paused:
                cv2.putText(
                    frame,
                    "[PAUSED]",
                    (20, 110 + text_height),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.8,
                    (0, 255, 255),
                    3
                )
        
        while True:
            if not paused:
                ret, frame = cap.read()
                if not ret:
                    # End of video or error
                    break
                
                frame_count += 1
                
                # Calculate brightness using foveated sampling
                brightness, cached_samples = calculate_brightness_from_frame(
                    frame, 
                    max_samples=max_samples,
                    fovea_size=fovea_size,
                    cached_samples=cached_samples
                )
                
                # Display brightness in console
                if percentage:
                    brightness_str = f"{brightness * 100:.2f}%"
                    print(f"Frame {frame_count}/{total_frames}: Brightness = {brightness_str}", end='\r')
                else:
                    print(f"Frame {frame_count}/{total_frames}: Brightness = {brightness:.4f}", end='\r')
            
            # Create a copy for overlay if needed
            display_frame = frame.copy() if frame is not None else None
            
            # Overlay brightness on video frame
            if display_frame is not None and show_video and show_overlay:
                add_overlay(display_frame, brightness, frame_count, total_frames, percentage, paused)
            
            # Display video
            if show_video and display_frame is not None:
                cv2.imshow('Video Brightness Analysis', display_frame)
                
                # Handle keyboard input
                key = cv2.waitKey(1) & 0xFF
                if key == ord('q'):
                    break
                elif key == ord('p'):
                    paused = not paused
                    if paused:
                        print("\n[PAUSED] Press 'p' to resume, 'q' to quit")
                    else:
                        print("\n[RESUMED]")
            elif not show_video:
                # If not showing video, add small delay to prevent overwhelming the console
                if not paused:
                    time.sleep(1.0 / fps if fps > 0 else 0.033)
                else:
                    time.sleep(0.1)
        
        # Cleanup
        cap.release()
        if show_video:
            cv2.destroyAllWindows()
        
        elapsed_time = time.time() - start_time
        print(f"\n{'=' * 50}")
        print(f"Processing complete!")
        print(f"Total frames processed: {frame_count}")
        print(f"Time elapsed: {elapsed_time:.2f} seconds")
        if frame_count > 0:
            print(f"Average processing speed: {frame_count / elapsed_time:.2f} FPS")
        
        return True
    
    except Exception as e:
        print(f"Error processing video '{video_path}': {str(e)}", file=sys.stderr)
        return False


def main():
    parser = argparse.ArgumentParser(
        description='Calculate perceived brightness of videos in real-time using WCAG Relative Luminance',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Process video in real-time (default: 100 samples, fovea size 0.4)
  python brightness_calculator.py video.mp4
  
  # Process video without display (console only)
  python brightness_calculator.py --no-display video.mp4
  
  # Process video with percentage display
  python brightness_calculator.py -p video.mp4
  
  # Custom sampling (50 samples, tighter fovea)
  python brightness_calculator.py --max-samples 50 --fovea-size 0.3 video.mp4
  
  # High accuracy (200 samples, wider fovea)
  python brightness_calculator.py --max-samples 200 --fovea-size 0.5 video.mp4
        """
    )
    parser.add_argument(
        'video',
        help='Path to video file'
    )
    parser.add_argument(
        '-p', '--percentage',
        action='store_true',
        help='Display brightness as percentage (0-100%%) instead of decimal (0.0-1.0)'
    )
    parser.add_argument(
        '--no-display',
        action='store_true',
        help='Do not display video window (console output only)'
    )
    parser.add_argument(
        '--no-overlay',
        action='store_true',
        help='Do not overlay brightness on video frames'
    )
    parser.add_argument(
        '--max-samples',
        type=int,
        default=100,
        help='Maximum number of pixels to sample per frame (default: 100)'
    )
    parser.add_argument(
        '--fovea-size',
        type=float,
        default=0.4,
        help='Size of fovea region 0-1, where 1 = full image (default: 0.4)'
    )
    
    args = parser.parse_args()
    
    # Validate arguments
    if args.max_samples < 1:
        print("Error: --max-samples must be at least 1", file=sys.stderr)
        sys.exit(1)
    if not (0.0 < args.fovea_size <= 1.0):
        print("Error: --fovea-size must be between 0 and 1", file=sys.stderr)
        sys.exit(1)
    
    # Process video
    success = process_video_realtime(
        args.video,
        show_video=not args.no_display,
        show_overlay=not args.no_overlay,
        percentage=args.percentage,
        max_samples=args.max_samples,
        fovea_size=args.fovea_size
    )
    
    if not success:
        sys.exit(1)


if __name__ == '__main__':
    main()

