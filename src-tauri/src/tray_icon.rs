use std::collections::VecDeque;

pub fn transparent_background(pixels: &[u8], width: usize, height: usize) -> Vec<u8> {
    let mut result = pixels.to_vec();
    if width == 0 || height == 0 {
        return result;
    }
    let mut visited = vec![false; width * height];
    let mut queue = VecDeque::new();
    for x in 0..width {
        queue.push_back(x);
        queue.push_back((height - 1) * width + x);
    }
    for y in 0..height {
        queue.push_back(y * width);
        queue.push_back(y * width + width - 1);
    }
    while let Some(index) = queue.pop_front() {
        if visited[index] {
            continue;
        }
        visited[index] = true;
        let offset = index * 4;
        let pixel = &pixels[offset..offset + 4];
        if pixel[3] != 0 && !pixel[..3].iter().all(|channel| *channel >= 240) {
            continue;
        }
        result[offset..offset + 4].fill(0);
        let x = index % width;
        let y = index / width;
        if x > 0 {
            queue.push_back(index - 1);
        }
        if x + 1 < width {
            queue.push_back(index + 1);
        }
        if y > 0 {
            queue.push_back(index - width);
        }
        if y + 1 < height {
            queue.push_back(index + width);
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn removes_the_outer_white_canvas_without_erasing_the_white_book() {
        let mut pixels = vec![255; 7 * 7 * 4];
        for y in 1..6 {
            for x in 1..6 {
                let index = (y * 7 + x) * 4;
                pixels[index..index + 4].copy_from_slice(&[40, 160, 240, 255]);
            }
        }
        pixels[96..100].copy_from_slice(&[255, 255, 255, 255]);
        let icon = transparent_background(&pixels, 7, 7);
        assert_eq!(&icon[..4], &[0, 0, 0, 0]);
        assert_eq!(&icon[24..28], &[0, 0, 0, 0]);
        assert_eq!(&icon[96..100], &[255, 255, 255, 255]);
        assert_eq!(&icon[32..36], &[40, 160, 240, 255]);
    }
}
