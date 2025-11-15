#!/usr/bin/env python3
"""
Video Brightness Calculator using WCAG Relative Luminance

This script calculates the perceived brightness of videos in real-time using the WCAG
Relative Luminance formula, which is based on human vision physiology.

Formula: L = 0.2126 * R + 0.7152 * G + 0.0722 * B
Where R, G, B are normalized to 0-1 range.
"""

import sys
import argparse
from pathlib import Path
import numpy as np
import cv2
import time


def calculate_brightness_from_frame(frame):
    """
    Calculate the perceived brightness of a frame (numpy array) using WCAG Relative Luminance.
    
    Args:
        frame: numpy array representing the image frame (BGR format from OpenCV)
        
    Returns:
        float: Average perceived brightness (0.0 to 1.0, where 0.0 is black and 1.0 is white)
    """
    # Convert BGR to RGB (OpenCV uses BGR by default)
    frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    
    # Normalize RGB values to 0-1 range
    rgb_normalized = frame_rgb.astype(np.float32) / 255.0
    
    # Extract R, G, B channels
    R = rgb_normalized[:, :, 0]
    G = rgb_normalized[:, :, 1]
    B = rgb_normalized[:, :, 2]
    
    # Apply WCAG Relative Luminance formula
    # L = 0.2126 * R + 0.7152 * G + 0.0722 * B
    luminance = 0.2126 * R + 0.7152 * G + 0.0722 * B
    
    # Calculate average brightness across all pixels
    average_brightness = np.mean(luminance)
    
    return average_brightness


def process_video_realtime(video_path, show_video=True, show_overlay=True, percentage=False):
    """
    Process video in real-time and calculate brightness for each frame.
    
    Args:
        video_path: Path to the video file
        show_video: Whether to display the video window
        show_overlay: Whether to overlay brightness on the video
        percentage: Whether to display brightness as percentage
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
                
                # Calculate brightness
                brightness = calculate_brightness_from_frame(frame)
                
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
  # Process video in real-time
  python brightness_calculator.py video.mp4
  
  # Process video without display (console only)
  python brightness_calculator.py --no-display video.mp4
  
  # Process video with percentage display
  python brightness_calculator.py -p video.mp4
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
    
    args = parser.parse_args()
    
    # Process video
    success = process_video_realtime(
        args.video,
        show_video=not args.no_display,
        show_overlay=not args.no_overlay,
        percentage=args.percentage
    )
    
    if not success:
        sys.exit(1)


if __name__ == '__main__':
    main()

